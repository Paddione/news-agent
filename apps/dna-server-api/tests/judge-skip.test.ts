import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { JudgeUnavailableError } from "../src/news/judge-runtime.ts";
import { startNewsSweep } from "../src/news/sweep.ts";
import { openApp } from "../src/runtime.ts";
import { until } from "./helpers.ts";

test("an unavailable judge skips the sweep with its reason and does not retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dna-skip-"));
  process.env.DNA_LOG_DIR = join(dir, "logs");
  const config = loadConfig([], {
    ...process.env,
    DNA_PROVIDER: "faux",
    DNA_SEARCH_MODE: "fixture",
    DNA_FIXTURE_SET: "news",
    DNA_DATA_DIR: dir,
  });
  let calls = 0;
  const app = await openApp(config, {
    decide: async () => {
      calls++;
      throw new JudgeUnavailableError("gpu_training");
    },
  });
  try {
    const started = await startNewsSweep(app, app.main, app.ctx, {
      trigger: "test",
      requestId: "skip:1",
    });
    const id = started.sweep!.id;
    await until(
      () =>
        app.store.sweeps.get(id)!.status !== "queued" &&
        app.store.sweeps.get(id)!.status !== "running",
      30_000,
      "sweep end",
    );
    const sweep = app.store.sweeps.get(id)!;
    assert.equal(sweep.status, "skipped");
    assert.equal(sweep.reason, "gpu_training");
    const atSkip = calls;
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(calls, atSkip, "no retry after the skip");
  } finally {
    await app.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});
