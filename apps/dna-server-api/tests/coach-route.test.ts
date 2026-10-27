import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { bootServer, type Booted } from "./server.ts";

const outbox = mkdtempSync(join(tmpdir(), "dna-coach-"));
let s: Booted;
before(async () => {
  s = await bootServer({ DNA_COACH_OUTBOX_DIR: outbox });
});
after(async () => {
  await s.cleanup();
  rmSync(outbox, { recursive: true, force: true });
});

test("newsDigest renders once per week, then reports not_due", async () => {
  const first = await s.cron.newsDigest({ scheduled: true });
  assert.equal(first.status, 200);
  assert.equal(first.data.status, "completed");
  const file = first.data.digest!.filename;
  assert.match(file, /^\d{4}-\d{2}-\d{2}-digest\.md$/);
  const body = readFileSync(join(outbox, file), "utf8");
  assert.match(body, /^# Coach digest /m);
  const second = await s.cron.newsDigest({ scheduled: true });
  assert.equal(second.data.status, "not_due");
});

test("newsDigest without scheduled always renders", async () => {
  const r = await s.cron.newsDigest({});
  assert.equal(r.data.status, "completed");
});
