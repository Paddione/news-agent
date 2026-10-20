import assert from "node:assert/strict";
import { test } from "node:test";
import { weightsOf } from "../src/news/rank.ts";
import { applyFeedback, planQueries, topicChoices } from "../src/news/taste.ts";
import { tempStore } from "./helpers.ts";

test("seeded keywords start without a group", () => {
  const { store, cleanup } = tempStore();
  try {
    const topics = store.taste.keywords("topic");
    assert.ok(topics.length > 0);
    assert.ok(topics.every((k) => k.groupId === undefined));
  } finally {
    cleanup();
  }
});

test("groups: add, find, update, remove; names are kebab-case and unique", () => {
  const { store, cleanup } = tempStore();
  try {
    const g = store.taste.addGroup("agent-harnesses", 1.5);
    assert.deepEqual(
      { name: g.name, weight: g.weight, enabled: g.enabled, topicCount: g.topicCount },
      { name: "agent-harnesses", weight: 1.5, enabled: true, topicCount: 0 },
    );
    assert.equal(store.taste.findGroup("agent-harnesses")?.id, g.id);
    assert.throws(() => store.taste.addGroup("agent-harnesses"), /already/);
    assert.throws(() => store.taste.addGroup("Agent Harness"), /kebab-case/);
    assert.equal(store.taste.updateGroup(g.id, { weight: 5 })?.weight, 2);
    assert.equal(store.taste.updateGroup(g.id, { enabled: false })?.enabled, false);
    const topic = store.taste.addKeyword("topic", "Claude Code CLI");
    store.taste.setKeywordGroup(topic.id, g.id);
    assert.equal(store.taste.group(g.id)?.topicCount, 1);
    assert.equal(store.taste.removeGroup(g.id), true);
    assert.equal(store.taste.keyword(topic.id)?.groupId, undefined);
    assert.equal(store.taste.groups().length, 0);
  } finally {
    cleanup();
  }
});

test("only topics take a group", () => {
  const { store, cleanup } = tempStore();
  try {
    const g = store.taste.addGroup("models");
    const facts = store.taste.addKeyword("facts", "benchmark table");
    assert.throws(() => store.taste.setKeywordGroup(facts.id, g.id), /only topics/i);
    const topic = store.taste.addKeyword("topic", "llama.cpp");
    assert.equal(store.taste.setKeywordGroup(topic.id, g.id)?.groupId, g.id);
    assert.equal(store.taste.setKeywordGroup(topic.id, null)?.groupId, undefined);
  } finally {
    cleanup();
  }
});

test("effective weight multiplies topic and group; disabled groups drop their topics", () => {
  const { store, cleanup } = tempStore();
  try {
    const g = store.taste.addGroup("agentic-resources", 1.2);
    const grouped = store.taste.addKeyword("topic", "MCP servers", 1.5);
    const loose = store.taste.addKeyword("topic", "loose topic", 0.8);
    store.taste.setKeywordGroup(grouped.id, g.id);
    assert.equal(store.taste.effectiveWeight(store.taste.keyword(grouped.id)!), 1.8);
    assert.equal(store.taste.effectiveWeight(store.taste.keyword(loose.id)!), 0.8);
    store.taste.updateGroup(g.id, { enabled: false });
    const active = store.taste.activeTopics().map((k) => k.term);
    assert.ok(!active.includes("MCP servers"));
    assert.ok(active.includes("loose topic"));
  } finally {
    cleanup();
  }
});

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
  return { card, item };
}

/** Only the given topics stay enabled, so draws are deterministic. */
function onlyTopics(store: any, terms: [string, number][]) {
  for (const k of store.taste.keywords("topic"))
    store.taste.updateKeyword(k.id, { enabled: false });
  return terms.map(([term, weight]) => store.taste.addKeyword("topic", term, weight));
}

test("planQueries draws by effective weight and skips disabled groups", () => {
  const { store, cleanup } = tempStore();
  try {
    const [heavy, light, off] = onlyTopics(store, [
      ["heavy topic", 1],
      ["light topic", 1],
      ["off topic", 2],
    ]);
    const big = store.taste.addGroup("big", 2);
    const small = store.taste.addGroup("small", 0.1);
    const disabled = store.taste.addGroup("disabled", 2, false);
    store.taste.setKeywordGroup(heavy.id, big.id);
    store.taste.setKeywordGroup(light.id, small.id);
    store.taste.setKeywordGroup(off.id, disabled.id);
    const first = planQueries(store, 1, { random: () => 0.5 }).map((k) => k.term);
    assert.deepEqual(first, ["heavy topic"]);
    const all = planQueries(store, 10, { random: () => 0.5 }).map((k) => k.term);
    assert.ok(!all.includes("off topic"));
  } finally {
    cleanup();
  }
});

test("weightsOf and topicChoices follow groups", () => {
  const { store, cleanup } = tempStore();
  try {
    const [mcp, other] = onlyTopics(store, [
      ["MCP servers", 1.5],
      ["other topic", 1],
    ]);
    const res = store.taste.addGroup("agentic-resources", 1.2);
    store.taste.setKeywordGroup(mcp.id, res.id);
    const { item } = seedCard(store, "An MCP server", "mcp servers");
    assert.equal(weightsOf(store, store.news.item(item.id)!).topic, 1.8);
    const ops = store.taste.addGroup("agent-ops", 1, false);
    store.taste.setKeywordGroup(other.id, ops.id);
    const choices = Object.values(topicChoices(store.taste.activeTopics()));
    assert.ok(choices.includes("MCP servers"));
    assert.ok(!choices.includes("other topic"));
  } finally {
    cleanup();
  }
});

test("feedback moves the topic weight, never the group weight", () => {
  const { store, cleanup } = tempStore();
  try {
    const [mcp] = onlyTopics(store, [["MCP servers", 1.5]]);
    const res = store.taste.addGroup("agentic-resources", 1.2);
    store.taste.setKeywordGroup(mcp.id, res.id);
    const { card } = seedCard(store, "An MCP server", "MCP servers");
    applyFeedback(store, card, { signal: "less" });
    assert.equal(store.taste.keyword(mcp.id)!.weight, 1.35);
    assert.equal(store.taste.group(res.id)!.weight, 1.2);
  } finally {
    cleanup();
  }
});

test("cards carry their topic's group; the group tab lists exactly those cards", () => {
  const { store, cleanup } = tempStore();
  try {
    const [claude, loose] = onlyTopics(store, [
      ["Claude Code", 1.5],
      ["loose topic", 1],
    ]);
    const harness = store.taste.addGroup("agent-harnesses", 1.5);
    store.taste.setKeywordGroup(claude.id, harness.id);
    const a = seedCard(store, "Claude Code hooks", "claude code").card;
    const b = seedCard(store, "Claude Code plugins", "Claude Code").card;
    const c = seedCard(store, "Something else", loose.term).card;
    assert.equal(store.news.card(a.id)?.group, "agent-harnesses");
    assert.equal(store.news.card(c.id)?.group, undefined);
    const ids = store.news.searchCards("group", "agent-harnesses").map((x) => x.id);
    assert.deepEqual([...ids].sort(), [a.id, b.id].sort());
    assert.deepEqual(store.news.searchCards("group", "no-such-group"), []);
  } finally {
    cleanup();
  }
});
