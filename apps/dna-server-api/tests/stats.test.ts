import assert from "node:assert/strict";
import { test } from "node:test";
import { StatsRepo, windowStart } from "../src/db/repos/stats.ts";
import { parseDays } from "../src/routes/stats.ts";
import { tempStore } from "./helpers.ts";

const NOW = new Date("2026-10-20T12:00:00Z");
const hfs = (primary: "hype" | "facts" | "signal", h: number, f: number, s: number) => ({
  hype: h,
  facts: f,
  signal: s,
  primary,
  labels: [primary],
  ranked: [{ category: primary, score: 90, confidence: 0.9 }],
  suspectCombo: false,
});

function seed() {
  const t = tempStore();
  const { store } = t;
  const at = (table: string, id: number, iso: string) =>
    store.db.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(iso, id);
  const item = (url: string, topic: string | undefined, day: string, source = "a.dev") => {
    const { item } = store.news.upsertItem({ url, title: url, sourceName: source });
    store.db
      .prepare("UPDATE items SET matched_topic = ?, attention = 50 WHERE id = ?")
      .run(topic ?? null, item.id);
    at("items", item.id, `${day}T08:00:00Z`);
    return item.id;
  };
  const i1 = item("https://a.dev/1", "agents", "2026-10-20");
  const i2 = item("https://a.dev/2", "agents", "2026-10-19");
  const i3 = item("https://b.dev/3", undefined, "2026-10-20", "b.dev");
  item("https://a.dev/old", "agents", "2026-10-01");
  for (const [id, p, h, f, s] of [
    [i1, "signal", 10, 60, 90],
    [i2, "hype", 80, 20, 10],
    [i3, "facts", 5, 85, 30],
  ] as const) {
    const c = store.news.addClassification({
      itemId: id,
      command: "hfs",
      version: 1,
      hfs: hfs(p, h, f, s),
    });
    at("classifications", c.id, "2026-10-20T09:00:00Z");
  }
  const card = (itemId: number, primary: string, toolCallId: string) => {
    const { card } = store.news.addCard({
      kind: "news",
      component: "brief",
      props: { title: "t", summary: "s" },
      itemId,
      hfs: hfs(primary as "signal", 1, 1, 1),
      attention: 50,
      toolCallId,
    });
    return card.id;
  };
  const c1 = card(i1, "signal", "tc-stats-1");
  const c2 = card(i2, "hype", "tc-stats-2");
  store.taste.addFeedback(c1, { labels: ["facts"] });
  store.taste.addFeedback(c1, { labels: ["facts", "signal"] });
  store.taste.addFeedback(c2, { labels: ["facts"] });
  store.taste.addFeedback(c2, { signal: "less" });
  store.taste.addFeedback(c1, { signal: "more" });
  store.db.prepare("UPDATE feedback SET created_at = '2026-10-20T10:00:00Z'").run();
  return t;
}

test("windowStart is UTC midnight days-1 back", () => {
  assert.equal(windowStart(1, NOW), "2026-10-20T00:00:00.000Z");
  assert.equal(windowStart(7, NOW), "2026-10-14T00:00:00.000Z");
});

test("stats aggregates topics, hfs and feedback inside the window", () => {
  const { store, cleanup } = seed();
  try {
    const s = new StatsRepo(store.db).stats(7, NOW);
    assert.deepEqual(s.window, {
      from: "2026-10-14T00:00:00.000Z",
      to: NOW.toISOString(),
      days: 7,
    });
    assert.deepEqual(
      s.topics.map((t) => `${t.topic}:${t.day}:${t.count}`).sort(),
      ["(none):2026-10-20:1", "agents:2026-10-19:1", "agents:2026-10-20:1"],
      "the item from 10-01 is outside the window",
    );
    assert.deepEqual(s.hfs.byDay, [
      { day: "2026-10-20", hype: 31.7, facts: 55, signal: 43.3, n: 3 },
    ]);
    assert.deepEqual(s.hfs.primary.map((p) => `${p.category}:${p.count}`).sort(), [
      "facts:1",
      "hype:1",
      "signal:1",
    ]);
    assert.deepEqual(s.feedback.byDay, [{ day: "2026-10-20", more: 1, less: 1 }]);
    const sig = s.feedback.byJudge.find((j) => j.judge === "signal")!;
    assert.deepEqual(
      sig,
      { judge: "signal", n: 1, humanHype: 0, humanFacts: 1, humanSignal: 1, hits: 1 },
      "latest labelled feedback wins",
    );
    const hype = s.feedback.byJudge.find((j) => j.judge === "hype")!;
    assert.equal(hype.hits, 0);
    assert.equal(s.feedback.agreement, 0.5);
  } finally {
    cleanup();
  }
});

test("an empty db gives empty blocks and agreement null", () => {
  const { store, cleanup } = tempStore();
  try {
    const s = new StatsRepo(store.db).stats(1, NOW);
    assert.deepEqual(s.topics, []);
    assert.deepEqual(s.funnel.sweeps, []);
    assert.deepEqual(s.funnel.total, {
      gathered: 0,
      kept: 0,
      duplicates: 0,
      candidates: 0,
      presented: 0,
    });
    assert.deepEqual(s.hfs.byDay, []);
    assert.deepEqual(s.feedback.byJudge, []);
    assert.equal(s.feedback.agreement, null);
  } finally {
    cleanup();
  }
});

test("parseDays defaults to 7 and refuses values outside 1..30", () => {
  assert.equal(parseDays(undefined), 7);
  assert.equal(parseDays("30"), 30);
  for (const bad of ["0", "31", "2.5", "x", ""])
    assert.throws(() => parseDays(bad), /days must be an integer from 1 to 30/);
});
