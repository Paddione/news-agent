import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { assembleDigest } from "../src/news/coach.ts";
import type { Store } from "../src/db/store.ts";
import { tempStore } from "./helpers.ts";

let s: { store: Store; dir: string; cleanup: () => void };
before(() => {
  s = tempStore();
  s.store.taste.addKeyword("topic", "MCP servers", 1.5);
  s.store.taste.addKeyword("topic", "GPUs", 0.9);
  s.store.taste.askQuestion({ question: "More like this?", toolCallId: "test-1" });
});
after(() => s.cleanup());

const adapter = () => ({
  keywords: () => s.store.taste.keywords(),
  recentFeedback: (n: number) => s.store.taste.recentFeedback(n),
  openQuestions: () => s.store.taste.questions("open"),
});

test("assemble writes one digest file, then reports not_due", () => {
  const outbox = mkdtempSync(join(tmpdir(), "dna-coach-"));
  try {
    const date = new Date("2026-10-28T12:00:00Z");
    const first = assembleDigest(adapter(), outbox, date);
    assert.equal(first.status, "completed");
    assert.equal(first.filename, "2026-10-28-digest.md");
    assert.ok(first.bytes > 0);
    const body = readFileSync(join(outbox, first.filename), "utf8");
    assert.match(body, /MCP servers/);
    assert.match(body, /More like this\?/);
    const mtime = statSync(join(outbox, first.filename)).mtimeMs;
    const second = assembleDigest(adapter(), outbox, date);
    assert.equal(second.status, "not_due");
    assert.equal(statSync(join(outbox, first.filename)).mtimeMs, mtime, "no rewrite on not_due");
  } finally {
    rmSync(outbox, { recursive: true, force: true });
  }
});

test("assemble creates a missing outbox dir", () => {
  const outbox = join(mkdtempSync(join(tmpdir(), "dna-coach-")), "nested", "outbox");
  try {
    const r = assembleDigest(adapter(), outbox, new Date("2026-10-29T12:00:00Z"));
    assert.equal(r.status, "completed");
    assert.ok(readFileSync(join(outbox, r.filename), "utf8").length > 0);
  } finally {
    rmSync(outbox, { recursive: true, force: true });
  }
});
