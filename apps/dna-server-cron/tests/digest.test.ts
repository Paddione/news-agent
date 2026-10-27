import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import type { Logger } from "@dna/sdk/node";
import { digestSlotId, digestTick } from "../src/digest.ts";

const silent = {
  info() {},
  warn() {},
  error() {},
  debug() {},
} as unknown as Logger;

test("digest slots are one per ISO week in UTC", () => {
  assert.equal(digestSlotId("mini", new Date("2026-10-26T10:00:00Z")), "digest:mini:2026W44");
  assert.equal(digestSlotId("mini", new Date("2026-11-01T23:59:59Z")), "digest:mini:2026W44");
  assert.equal(digestSlotId("mini", new Date("2026-11-02T00:00:00Z")), "digest:mini:2026W45");
});

test("digest tick posts the weekly slot and reports completed", async () => {
  let seen: { url?: string; auth?: string; body?: string } = {};
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen = { url: req.url, auth: req.headers.authorization, body: raw };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "completed",
          digest: {
            filename: "2026-10-26-digest.md",
            bytes: 10,
            topics: 1,
            feedback: 0,
            questions: 0,
          },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as { port: number }).port;
    const r = await digestTick({
      apiUrl: `http://127.0.0.1:${port}`,
      token: "tok",
      device: "mini",
      log: silent,
      now: new Date("2026-10-28T12:00:00Z"),
      backoffMs: [1, 1, 1],
    });
    assert.equal(r.ok, true);
    assert.equal(r.requestId, "digest:mini:2026W44");
    assert.equal(r.result?.status, "completed");
    assert.equal(seen.url, "/v1/workflows/news-digest");
    assert.equal(seen.auth, "Bearer tok");
    assert.match(seen.body ?? "", /"scheduled":true/);
  } finally {
    server.close();
  }
});

test("digest tick retries a 500 then reports the retry", async () => {
  let calls = 0;
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      calls += 1;
      if (calls === 1) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "boom" } }));
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "not_due", reason: "digest already rendered this week" }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as { port: number }).port;
    const r = await digestTick({
      apiUrl: `http://127.0.0.1:${port}`,
      token: "tok",
      device: "mini",
      log: silent,
      backoffMs: [1, 1, 1],
    });
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 2);
    assert.equal(r.result?.status, "not_due");
    assert.equal(calls, 2);
  } finally {
    server.close();
  }
});
