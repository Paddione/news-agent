import assert from "node:assert/strict";
import { test } from "node:test";
import { answerFrom } from "../src/local.ts";
import {
  NEED_LEVELS,
  NEED_QUESTION_VERSION,
  NEED_THRESHOLD,
  needQuestion,
  needScore,
  needVerdict,
} from "../src/need-question.ts";

test("need question is a score question with a five-level implementation-need rubric", () => {
  assert.equal(NEED_QUESTION_VERSION, 1);
  assert.equal(NEED_LEVELS.length, 5);
  for (const level of NEED_LEVELS) assert.ok(level.trim().length > 0);
  const q = needQuestion();
  assert.equal(q.type, "score");
  assert.ok(typeof q.instructions === "string" && q.instructions.trim().length > 0);
  assert.deepEqual(q.criteria, NEED_LEVELS);
});

test("mock judge probabilities map to a weighted need score (mirrors answerFrom score branch)", () => {
  // Half mass on level 3, half on level 4 -> score 3.5 of 4 -> 0.875, clears the gate.
  const high = answerFrom(needQuestion(), [0, 0, 0, 0.5, 0.5]);
  assert.equal(high.type, "score");
  if (high.type === "score") {
    assert.equal(high.score, 3.5);
    assert.equal(needScore(high), 0.875);
    assert.equal(needVerdict(needScore(high)), "ready");
  }
  // Mass on levels 0-1 -> score 0.3 of 4 -> 0.075, stays in triage.
  const low = answerFrom(needQuestion(), [0.7, 0.3, 0, 0, 0]);
  assert.equal(low.type, "score");
  if (low.type === "score") {
    assert.equal(low.score, 0.3);
    assert.equal(needScore(low), 0.075);
    assert.equal(needVerdict(needScore(low)), "triage");
  }
});

test("threshold is 0.7 and the boundary clears the gate", () => {
  assert.equal(NEED_THRESHOLD, 0.7);
  assert.equal(needVerdict(0.7), "ready");
  assert.equal(needVerdict(0.6999), "triage");
  assert.equal(needVerdict(0.7, 0.8), "triage");
});

test("needScore normalizes across the levels and clamps", () => {
  const s = (score: number) => ({
    type: "score" as const,
    score,
    confidence: 0.8,
    legend: Object.fromEntries(NEED_LEVELS.map((l, i) => [String(i), l])),
    probabilities: {},
  });
  assert.equal(needScore(s(0)), 0);
  assert.equal(needScore(s(4)), 1);
  assert.equal(needScore(s(2)), 0.5);
  assert.equal(needScore(s(99)), 1);
  assert.equal(needScore(s(-1)), 0);
});
