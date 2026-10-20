import assert from "node:assert/strict";
import { test } from "node:test";
import { droppedNote, evidenceText, supported, verifyFigures } from "../src/news/figures.ts";

const ARTICLE =
  "Released in 2025, the model scores 72.5% on SWE-bench (up from 61). It costs $3 per 1M tokens, " +
  "serves 1,234 requests a second, has 1.2k stars, 4 billion parameters and 7.3M downloads.";

test("each spelling of a number is found in the article", () => {
  for (const v of [72.5, 61, 3, 1234, 1200, 4e9, 7.3e6]) assert.ok(supported(v, ARTICLE), `${v}`);
  assert.ok(supported(72.5, "scores 72,5 %"), "decimal comma");
  assert.ok(supported(1234, "1.234 requests"), "dot thousands");
  assert.ok(supported(1234, "1 234 requests"), "space thousands");
});

test("a number inside a longer number does not count", () => {
  assert.equal(supported(5, ARTICLE), false, "5 is inside 2025 and 72.5");
  assert.equal(supported(72, ARTICLE), false, "72 is the start of 72.5");
  assert.equal(supported(1, "has 1.2k stars"), false, "1 is the start of 1.2k");
  assert.equal(supported(4, ARTICLE), false, "4 is followed by billion");
  assert.equal(supported(202, ARTICLE), false);
});

test("verifyFigures keeps backed numbers, drops the rest with a reason, and caps at 6", () => {
  const { kept, dropped } = verifyFigures(
    [
      { label: "SWE-bench", value: 72.5, unit: "%", group: "bench" },
      { label: "previous", value: 61, unit: "%", group: "bench" },
      { label: "made up", value: 88 },
      { label: "", value: 3 },
      { label: "not a number", value: "12" },
      { label: "a", value: 3 },
      { label: "b", value: 1234 },
      { label: "c", value: 1200 },
      { label: "d", value: 4e9 },
      { label: "e", value: 7.3e6 },
    ],
    ARTICLE,
  );
  assert.deepEqual(
    kept.map((f) => f.label),
    ["SWE-bench", "previous", "a", "b", "c", "d"],
  );
  assert.deepEqual(
    dropped.map((d) => `${d.label}:${d.reason}`),
    ["made up:unsupported", ":invalid", "not a number:invalid", "e:over_limit"],
  );
  assert.equal(droppedNote(dropped).startsWith(" Dropped figures: made up 88 (unsupported)"), true);
  assert.equal(droppedNote([]), "");
});

test("no evidence drops everything, no figures is a no-op, a non array is invalid", () => {
  assert.deepEqual(
    verifyFigures([{ label: "x", value: 1 }], "  ").dropped.map((d) => d.reason),
    ["no_evidence"],
  );
  assert.deepEqual(verifyFigures(undefined, ARTICLE), { kept: [], dropped: [] });
  assert.deepEqual(
    verifyFigures("72.5", ARTICLE).dropped.map((d) => d.reason),
    ["invalid"],
  );
  assert.equal(
    verifyFigures([{ label: "x".repeat(61), value: 61 }], ARTICLE).dropped[0].reason,
    "invalid",
  );
});

test("evidenceText joins cached text, excerpt and findings", () => {
  const text = evidenceText({
    contentMd: "a 1",
    excerpt: "b 2",
    findings: [{ summary: "c 3", claims: ["d 4"], evidence: ["https://e.dev/5"] }],
  });
  for (const v of [1, 2, 3, 4]) assert.ok(supported(v, text), `${v}`);
});
