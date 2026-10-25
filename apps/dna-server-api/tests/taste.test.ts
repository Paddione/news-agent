import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFeedback, planQueries, tasteExamples, topicChoices } from "../src/news/taste.ts";
import { tempStore } from "./helpers.ts";

function seedCard(store: any, title: string, matchedTopic?: string) {
  const { item } = store.news.upsertItem({
    url: `https://x.dev/${encodeURIComponent(title)}`,
    title,
    excerpt: title,
  });
  if (matchedTopic) store.news.updateItem(item.id, { matchedTopic });
  const { card } = store.news.addCard({
    kind: "news",
    component: "brief",
    props: { title, summary: title },
    itemId: item.id,
    toolCallId: `call-${title}`,
    hfs: {
      hype: 10,
      facts: 80,
      signal: 70,
      primary: "facts",
      labels: ["facts", "signal"],
      ranked: [],
      suspectCombo: false,
    },
  });
  return card;
}

test("show me more and less move the matched topic weight, clamped", () => {
  const { store, cleanup } = tempStore();
  try {
    const card = seedCard(store, "Claude Code ships a new hook", "Claude Code");
    const before = store.taste.findKeyword("topic", "Claude Code")!.weight;
    const more = applyFeedback(store, card, { signal: "more" });
    assert.equal(more.changed[0].to, Math.round((before + 0.1) * 100) / 100);
    for (let i = 0; i < 20; i++) applyFeedback(store, card, { signal: "less" });
    assert.equal(store.taste.findKeyword("topic", "Claude Code")!.weight, 0.1);
  } finally {
    cleanup();
  }
});

test("a down-vote leaves a matched topic alone when the card never names it", () => {
  const { store, cleanup } = tempStore();
  try {
    const card = seedCard(store, "SpeedCrunch 1.1, a desktop calculator", "Claude Code");
    const before = store.taste.findKeyword("topic", "Claude Code")!.weight;
    const less = applyFeedback(store, card, { signal: "less" });
    assert.equal(store.taste.findKeyword("topic", "Claude Code")!.weight, before);
    assert.ok(!less.changed.some((c) => c.kind === "topic"));
    applyFeedback(store, card, { signal: "more" });
    assert.equal(
      store.taste.findKeyword("topic", "Claude Code")!.weight,
      Math.round((before + 0.1) * 100) / 100,
    );
  } finally {
    cleanup();
  }
});

test("labels move section keywords found in the card", () => {
  const { store, cleanup } = tempStore();
  try {
    const card = seedCard(store, "A breaking change in the changelog");
    applyFeedback(store, card, { labels: ["signal"] });
    assert.equal(store.taste.findKeyword("signal", "breaking change")!.weight, 1.1);
    assert.equal(
      store.taste.findKeyword("facts", "changelog")!.weight,
      0.9,
      "jev said facts, the reader did not",
    );
    assert.equal(tasteExamples(store)[0].reader, "labeled");
  } finally {
    cleanup();
  }
});

test("a sweep's bag of topics is a draw weighted by favor, and a second bag skips the first", () => {
  const { store, cleanup } = tempStore();
  try {
    const all = store.taste.keywords("topic", true);
    const heavy = store.taste.findKeyword("topic", "pi-durable")!;
    const light = store.taste.findKeyword("topic", "exe.dev")!;
    store.taste.updateKeyword(heavy.id, { weight: 2 });
    store.taste.updateKeyword(light.id, { weight: 0.1 });
    const bag = planQueries(store, 15);
    assert.equal(bag.length, Math.min(15, all.length));
    assert.equal(new Set(bag.map((k) => k.id)).size, bag.length, "no topic twice in a bag");
    const second = planQueries(store, 15, { exclude: bag.map((k) => k.term) });
    assert.ok(
      !second.some((k) => bag.some((b) => b.id === k.id)),
      "the second bag is a fresh shuffle",
    );
    // Over many draws a heavy topic comes up far more often than a light one.
    let seeded = 7;
    const random = () => (seeded = (seeded * 16807) % 2147483647) / 2147483647;
    const counts = { heavy: 0, light: 0 };
    for (let i = 0; i < 300; i++) {
      const terms = planQueries(store, 3, { random }).map((k) => k.id);
      if (terms.includes(heavy.id)) counts.heavy++;
      if (terms.includes(light.id)) counts.light++;
    }
    assert.ok(counts.heavy > counts.light * 5, `heavy ${counts.heavy}, light ${counts.light}`);
    const choices = topicChoices(store.taste.keywords("topic"));
    assert.equal(choices.pi_durable, "pi-durable");
    assert.equal(choices.none, "None of these topics");
  } finally {
    cleanup();
  }
});

test("a vote moves the card's source weight too, and ranking weighs topic, source and freshness", async () => {
  const { rankScore, freshness, weightsOf } = await import("../src/news/rank.ts");
  const { store, cleanup } = tempStore();
  try {
    const simon = store.sources.list().find((s) => s.name === "Simon Willison")!;
    const { item } = store.news.upsertItem({
      url: "https://simonwillison.net/2026/Oct/13/durable-agents/",
      title: "Durable agents on Simon's blog",
      excerpt: "Durable agents",
      sourceId: simon.id,
    });
    store.news.updateItem(item.id, { matchedTopic: "durable agents" });
    const { card } = store.news.addCard({
      kind: "news",
      component: "brief",
      props: { title: "Durable agents on Simon's blog", summary: "s" },
      itemId: item.id,
      toolCallId: "source-weight",
    });
    const r = applyFeedback(store, card, { signal: "less" });
    const moved = r.changed.find((c) => c.kind === "source");
    assert.ok(moved, "the source moved with the topic");
    assert.equal(moved!.to, Math.round((simon.weight - 0.15) * 100) / 100);
    assert.equal(store.sources.get(simon.id)!.weight, moved!.to);
    const weights = weightsOf(store, store.news.item(item.id)!);
    assert.equal(weights.source, moved!.to);
    const fresh = new Date().toISOString();
    const old = new Date(Date.now() - 6 * 86_400_000).toISOString();
    assert.equal(freshness(fresh), 1);
    assert.ok(freshness(old) < 1);
    assert.ok(
      rankScore(0.8, { topic: 1, source: 1 }, fresh) > rankScore(0.8, { topic: 1, source: 1 }, old),
    );
    assert.ok(
      rankScore(0.8, { topic: 1, source: 1.5 }, fresh) >
        rankScore(0.8, { topic: 1, source: 0.5 }, fresh),
    );
  } finally {
    cleanup();
  }
});
