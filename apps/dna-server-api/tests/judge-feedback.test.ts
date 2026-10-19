// apps/dna-server-api/tests/judge-feedback.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { feedbackRows, type FeedbackEntry } from "../scripts/judge-feedback.ts";

// Distinct instructions per question: identical questions render one prompt and export dedupes them.
const score = (instructions: string) => ({
  type: "score",
  instructions,
  criteria: ["a", "b", "c", "d"],
});
const hfsCap = (item: number, at: string, title = `t${item}`) =>
  JSON.stringify({
    command: "hfs",
    version: 2,
    item_id: item,
    at,
    state: { title },
    questions: { hype: score("h"), facts: score("f"), signal: score("s") },
  });
const worthCap = (item: number, at: string) =>
  JSON.stringify({
    command: "worth-attention",
    version: 1,
    item_id: item,
    at,
    state: { title: `t${item}` },
    questions: { worth: { type: "noul", instructions: "w" }, novelty: score("n") },
  });
const fb = (over: Partial<FeedbackEntry>): FeedbackEntry => ({
  cardId: 1,
  itemId: 7,
  signal: null,
  labels: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  ...over,
});

test("hfs labels become one row per category: labeled means score 2 or 3, unlabeled 0 or 1", () => {
  const rows = feedbackRows(
    [fb({ labels: ["signal", "facts"] })],
    [hfsCap(7, "2026-10-20T09:00:00.000Z")],
  );
  const by = Object.fromEntries(rows.map((r) => [r.question_id, r.human.allowed]));
  assert.deepEqual(by, { hype: [0, 1], facts: [2, 3], signal: [2, 3] });
  assert.ok(rows.every((r) => r.command === "hfs" && r.item_id === 7 && r.human.card_id === 1));
});

test("more and less answer worth-attention's worth question only", () => {
  const caps = [worthCap(7, "2026-10-20T09:00:00.000Z")];
  const [more] = feedbackRows([fb({ signal: "more" })], caps);
  const [less] = feedbackRows([fb({ signal: "less" })], caps);
  assert.equal(more.question_id, "worth");
  assert.deepEqual(more.human.allowed, [0]); // labels ["yes", "no"]
  assert.deepEqual(less.human.allowed, [1]);
  assert.equal(feedbackRows([fb({ signal: "more" })], caps).length, 1);
});

test("the prompt is the judge call the reader saw: the latest capture before the feedback", () => {
  const caps = [
    hfsCap(7, "2026-10-20T08:00:00.000Z", "first"),
    hfsCap(7, "2026-10-20T09:00:00.000Z", "rescored"),
    hfsCap(7, "2026-10-20T11:00:00.000Z", "after"),
  ];
  const [row] = feedbackRows([fb({ labels: ["hype"] })], caps);
  assert.match(row.prompt, /rescored/);
});

test("the latest feedback per card and kind wins, and cards without item or capture are skipped", () => {
  const caps = [hfsCap(7, "2026-10-20T09:00:00.000Z")];
  const rows = feedbackRows(
    [
      fb({ labels: ["hype"], createdAt: "2026-10-20T10:00:00.000Z" }),
      fb({ labels: ["signal"], createdAt: "2026-10-20T10:05:00.000Z" }),
      fb({ cardId: 2, itemId: null, labels: ["facts"] }),
      fb({ cardId: 3, itemId: 99, labels: ["facts"] }),
    ],
    caps,
  );
  assert.equal(rows.length, 3);
  const signal = rows.find((r) => r.question_id === "signal")!;
  assert.deepEqual(signal.human.allowed, [2, 3]);
});

test("captures without a timestamp (before at was recorded) still match", () => {
  const legacy = JSON.stringify({ ...JSON.parse(hfsCap(7, "x")), at: undefined });
  assert.equal(feedbackRows([fb({ labels: [] })], [legacy]).length, 3);
});
