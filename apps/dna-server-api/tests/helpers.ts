import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../src/config.ts";
import { openStore, type Store } from "../src/db/store.ts";
import { openApp, type App } from "../src/runtime.ts";
// Shared poll helper: single source in @dna/durable-agent's tests, re-exported here so both suites poll alike.
import { until } from "../../shared/packages/durable-agent/tests/helpers.ts";

export { until };

export const ROOT = join(import.meta.dirname, "../../..");
export const CONFIG_DIR = join(import.meta.dirname, "../config");
export const PROMPTS_DIR = join(import.meta.dirname, "../prompt_engineering");

export function tempStore(): { store: Store; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "dna-api-"));
  const store = openStore(dir, CONFIG_DIR);
  return {
    store,
    dir,
    cleanup: () => {
      try {
        store.close();
      } catch {}
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A faux app on fixture feeds and fixture jev, in a temp dir. */
export async function fauxApp(
  env: Record<string, string> = {},
): Promise<{ app: App; dir: string; config: Config; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "dna-app-"));
  process.env.DNA_LOG_DIR = join(dir, "logs");
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const config = loadConfig([], {
    ...process.env,
    DNA_PROVIDER: "faux",
    DNA_SEARCH_MODE: "fixture",
    DNA_DATA_DIR: dir,
    ...env,
  });
  const app = await openApp(config);
  return {
    app,
    dir,
    config,
    cleanup: async () => {
      try {
        await app.close();
      } catch {}
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function waitForSweep(app: App, sweepId: number, ms = 30_000) {
  await until(
    () =>
      ["completed", "no_news", "failed", "stalled"].includes(app.store.sweeps.get(sweepId)!.status),
    ms,
    `sweep ${sweepId}`,
  );
  await app.main.waitForIdle(app.ctx);
  await new Promise((r) => setTimeout(r, 1700));
  return app.store.sweeps.get(sweepId)!;
}
