// apps/dna-server-api/tests/model-route.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelRoute } from "../src/agents/model-route.ts";

const LOCAL = "swift-1.5-qwen3.8-27b-iq3xxs";
const HOSTED = "muse-spark-1.3-contributor";

function route(
  up: boolean[],
  options: { fallback?: string; dailyCap?: number; day?: () => string } = {},
) {
  const answers = [...up];
  return new ModelRoute({
    localModel: LOCAL,
    fallbackModel: "fallback" in options ? options.fallback : HOSTED,
    dailyCap: options.dailyCap ?? 10,
    probe: async () => answers.shift() ?? true,
    day: options.day,
  });
}

test("a reachable local server keeps every model id as it is", async () => {
  const r = route([true]);
  assert.equal(await r.check(), "local");
  assert.equal(r.modelFor(LOCAL), LOCAL);
});

test("a down local server routes the local model to the fallback, and back once it answers again", async () => {
  const r = route([false, true]);
  assert.equal(await r.check(), "fallback");
  assert.equal(r.modelFor(LOCAL), HOSTED);
  assert.equal(r.modelFor("some/other-model"), "some/other-model");
  assert.equal(await r.check(), "local");
  assert.equal(r.modelFor(LOCAL), LOCAL);
});

test("without a fallback a down local server means no agent model", async () => {
  const r = route([false], { fallback: undefined });
  assert.equal(await r.check(), "down");
  assert.equal(r.modelFor(LOCAL), LOCAL);
});

test("the daily cap counts fallback sweeps and resets the next day", async () => {
  let day = "2026-10-20";
  const r = route([false, false, false, false], { dailyCap: 2, day: () => day });
  assert.equal(await r.check(), "fallback");
  assert.equal(await r.check(), "fallback");
  assert.equal(await r.check(), "down");
  assert.equal(r.modelFor(LOCAL), LOCAL);
  day = "2026-10-21";
  assert.equal(await r.check(), "fallback");
});

test("config: the fallback is off until DNA_FALLBACK_BASE_URL and DNA_FALLBACK_MODEL are set", async () => {
  const { loadConfig } = await import("../src/config.ts");
  const base = { DNA_PROVIDER: "local", DNA_ENV_FILE: "none" };
  assert.equal(loadConfig([], base).fallback, undefined);
  const config = loadConfig([], {
    ...base,
    DNA_FALLBACK_BASE_URL: "https://api.meta.ai/v1",
    DNA_FALLBACK_MODEL: HOSTED,
    DNA_FALLBACK_COST: "0.1,0.2",
  });
  assert.deepEqual(config.fallback, {
    baseUrl: "https://api.meta.ai/v1",
    model: HOSTED,
    contextWindow: 1_000_000,
    dailySweeps: 24,
    minIntervalMinutes: 120,
    cost: { input: 0.1, output: 0.2 },
    api: "openai-completions",
  });
  const custom = loadConfig([], {
    ...base,
    DNA_FALLBACK_BASE_URL: "https://api.meta.ai/v1",
    DNA_FALLBACK_MODEL: HOSTED,
    DNA_FALLBACK_CONTEXT: "500000",
    DNA_FALLBACK_API: "openai-responses",
    DNA_FALLBACK_HEADERS: '{"x-opencode-session":"dna-cluster"}',
  });
  assert.equal(custom.fallback?.contextWindow, 500_000);
  assert.equal(custom.fallback?.api, "openai-responses");
  assert.deepEqual(custom.fallback?.headers, { "x-opencode-session": "dna-cluster" });
});

test("AgentModelRoute reconfigures the main conversation only when the routed model changes", async () => {
  const { AgentModelRoute } = await import("../src/agents/model-route.ts");
  const configured: unknown[] = [];
  const main = { configure: async (change: unknown) => void configured.push(change) } as never;
  const catalog = {
    ref: (id: string) => ({ provider: id === LOCAL ? "local" : "fallback", modelId: id }),
  };
  const agent = new AgentModelRoute(route([true, false, false, true]), {
    catalog,
    selected: () => LOCAL,
  });
  assert.equal(await agent.ensure(main, {} as never), "local");
  assert.equal(configured.length, 0);
  assert.equal(await agent.ensure(main, {} as never), "fallback");
  assert.equal(await agent.ensure(main, {} as never), "fallback");
  assert.equal(await agent.ensure(main, {} as never), "local");
  assert.deepEqual(configured, [
    { model: { provider: "fallback", modelId: HOSTED } },
    { model: { provider: "local", modelId: LOCAL } },
  ]);
  assert.equal(agent.modelFor(LOCAL), LOCAL);
});

test("a sweep with no agent model (local down, no fallback left) is skipped, not started", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadConfig } = await import("../src/config.ts");
  const { openApp } = await import("../src/runtime.ts");
  const { startNewsSweep } = await import("../src/news/sweep.ts");
  const dir = mkdtempSync(join(tmpdir(), "dna-route-"));
  process.env.DNA_LOG_DIR = join(dir, "logs");
  const app = await openApp(
    loadConfig([], {
      ...process.env,
      DNA_PROVIDER: "faux",
      DNA_SEARCH_MODE: "fixture",
      DNA_DATA_DIR: dir,
    }),
  );
  try {
    app.route = { ensure: async () => "down" as const, modelFor: (id: string) => id };
    const result = await startNewsSweep(app, app.main, app.ctx, {
      trigger: "test",
      requestId: "route-down",
    });
    assert.equal(result.status, "skipped");
    assert.match(result.sweep!.reason ?? "", /agent model unavailable/);
    assert.equal(app.store.sweeps.active().length, 0);
  } finally {
    await app.close();
  }
});

test("fallback sweeps are throttled to one per interval, and the last one survives a restart", async () => {
  let now = Date.parse("2026-10-20T10:00:00Z");
  let saved: number | undefined;
  const make = () =>
    new ModelRoute({
      localModel: LOCAL,
      fallbackModel: HOSTED,
      dailyCap: 24,
      minIntervalMs: 2 * 3_600_000,
      probe: async () => false,
      now: () => now,
      lastFallback: { get: () => saved, set: (ms) => void (saved = ms) },
    });
  const r = make();
  assert.equal(await r.check(), "fallback");
  now += 30 * 60_000;
  assert.equal(await r.check(), "throttled");
  assert.equal(r.modelFor(LOCAL), HOSTED); // chat and quick jobs still reach the fallback between sweeps
  assert.equal(await make().check(), "throttled"); // a restarted API reads the stored time
  now += 90 * 60_000;
  assert.equal(await make().check(), "fallback");
});

test("a throttled route skips the sweep with the time the next fallback sweep may run", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadConfig } = await import("../src/config.ts");
  const { openApp } = await import("../src/runtime.ts");
  const { startNewsSweep } = await import("../src/news/sweep.ts");
  const dir = mkdtempSync(join(tmpdir(), "dna-route-"));
  process.env.DNA_LOG_DIR = join(dir, "logs");
  const app = await openApp(
    loadConfig([], {
      ...process.env,
      DNA_PROVIDER: "faux",
      DNA_SEARCH_MODE: "fixture",
      DNA_DATA_DIR: dir,
    }),
  );
  try {
    app.route = { ensure: async () => "throttled" as const, modelFor: (id: string) => id };
    const result = await startNewsSweep(app, app.main, app.ctx, {
      trigger: "test",
      requestId: "route-throttled",
    });
    assert.equal(result.status, "skipped");
    assert.match(result.sweep!.reason ?? "", /fallback: at most one sweep every/);
  } finally {
    await app.close();
  }
});
