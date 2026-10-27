import assert from "node:assert/strict";
import { test } from "node:test";
import { digestFilename, isNewDigest, renderDigest } from "../src/news/coach.ts";

const sample = {
  keywords: [
    { term: "MCP servers", kind: "topic", weight: 1.4 },
    { term: "hype", kind: "label", weight: 0.3 },
    { term: "GPUs", kind: "topic", weight: 0.9 },
  ],
  feedback: [
    {
      title: "New MCP server released",
      signal: "more" as const,
      labels: ["signal"],
      at: "2026-10-27T10:00:00Z",
    },
    {
      title: "Celebrity gossip",
      signal: "less" as const,
      labels: ["hype"],
      at: "2026-10-27T11:00:00Z",
    },
  ],
  questions: [
    { id: 7, question: "More like this?", status: "open", cardId: 42 },
    { id: 8, question: "Old one", status: "answered" },
  ],
};

test("digest filename is UTC-dated", () => {
  assert.equal(digestFilename(new Date("2026-10-27T23:00:00Z")), "2026-10-27-digest.md");
});

test("dedup: only unknown filenames are new", () => {
  assert.equal(isNewDigest(["2026-10-26-digest.md"], "2026-10-27-digest.md"), true);
  assert.equal(isNewDigest(["2026-10-27-digest.md"], "2026-10-27-digest.md"), false);
});

test("digest renders topics sorted, feedback signs, open questions only", () => {
  const md = renderDigest(sample, new Date("2026-10-27T23:00:00Z"));
  assert.match(md, /^# Coach digest 2026-10-27$/m);
  const mcp = md.indexOf("MCP servers");
  const gpus = md.indexOf("GPUs");
  assert.ok(mcp !== -1 && gpus !== -1 && mcp < gpus);
  assert.ok(!md.includes("hype |"), "label keywords are not topics");
  assert.match(md, /\+1 New MCP server released \[signal\]/);
  assert.match(md, /-1 Celebrity gossip \[hype\]/);
  assert.match(md, /- #7: More like this\? \(card 42\)/);
  assert.ok(!md.includes("Old one"), "answered questions are skipped");
});

test("empty input renders headers without rows", () => {
  const md = renderDigest({ keywords: [], feedback: [], questions: [] });
  assert.match(md, /Topics: 0, recent feedback: 0, open questions: 0\./);
});

test("pipes and newlines in titles do not break the table", () => {
  const md = renderDigest({
    keywords: [{ term: "a|b", kind: "topic", weight: 1 }],
    feedback: [],
    questions: [],
  });
  assert.match(md, /\| a\\\|b \| 1\.00 \|/);
});
