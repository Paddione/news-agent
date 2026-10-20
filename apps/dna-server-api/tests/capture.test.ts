// apps/dna-server-api/tests/capture.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { jsonlCapture } from "../src/news/capture.ts";

const rec = {
  command: "hfs",
  version: 2,
  item_id: 7,
  at: "2026-10-20T00:00:00.000Z",
  state: { t: 1 },
  questions: { q: { type: "noul" as const, instructions: "x" } },
};

test("capture appends one JSON line per call", () => {
  const dir = mkdtempSync(join(tmpdir(), "cap-"));
  const capture = jsonlCapture(join(dir, "c.jsonl"));
  capture(rec);
  capture({ ...rec, item_id: null });
  const lines = readFileSync(join(dir, "c.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], rec);
});

test("an unwritable capture path logs and never throws", () => {
  const warnings: unknown[] = [];
  const capture = jsonlCapture("/proc/forbidden/c.jsonl", {
    warn: (...a: unknown[]) => warnings.push(a),
  } as any);
  assert.doesNotThrow(() => capture(rec));
  assert.equal(warnings.length, 1);
});

test("Judge.run hands every rendered call to the capture hook", async () => {
  const { JevClient } = await import("@dna/jev");
  const { Judge } = await import("../src/news/hfs.ts");
  const { tempStore, PROMPTS_DIR } = await import("./helpers.ts");
  const { store, cleanup } = tempStore();
  const seen: unknown[] = [];
  const client = new JevClient({ provider: "mock" });
  const judge = new Judge({
    decide: (s, q, o) => client.systemOne(s, q, o),
    store,
    dir: join(PROMPTS_DIR, "jev"),
    capture: (r) => seen.push(r),
  });
  try {
    await judge.run(
      "relevance",
      {
        title: "T",
        source: "S",
        excerpt: "E",
        topic_keywords: [{ topic: "ai", weight: 1 }],
        taste_examples: [],
        topic_choices: { ai: null },
      },
      { itemId: 9 },
    );
    assert.equal(seen.length, 1);
    const rec = seen[0] as {
      command: string;
      version: number;
      item_id: number;
      at: string;
      state: { title: string };
      questions: object;
    };
    assert.equal(rec.command, "relevance");
    assert.equal(rec.item_id, 9);
    // judge-feedback matches a reader's feedback to the call made before it
    assert.ok(Math.abs(Date.parse(rec.at) - Date.now()) < 60_000);
    assert.equal(rec.state.title, "T");
    assert.ok("relevance" in rec.questions);
  } finally {
    cleanup();
  }
});
