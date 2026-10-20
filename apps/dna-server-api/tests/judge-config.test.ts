import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { openApp } from "../src/runtime.ts";

function localConfig(dir: string, manifest: string) {
  process.env.DNA_LOG_DIR = join(dir, "logs");
  return loadConfig([], {
    ...process.env,
    DNA_PROVIDER: "faux",
    DNA_SEARCH_MODE: "fixture",
    DNA_DATA_DIR: dir,
    JEV_BACKEND: "local",
    JEV_MANIFEST: manifest,
    NEWS_GPU_SESSION: "/bin/false",
  });
}

test("under node:test the local backend falls back to mock, like JevClient, unless JEV_LIVE=1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dna-judgecfg-"));
  const app = await openApp(localConfig(dir, join(dir, "missing-manifest.json")));
  try {
    assert.ok(app);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a manifest trained on another template is refused at startup, before any GPU session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dna-judgecfg-"));
  const manifest = join(dir, "manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      name: "news-judge",
      version: "x",
      gguf: "x.gguf",
      base_model: "b",
      temperature: 1,
      min_mass: 0.5,
      template_sha: "0".repeat(64),
      commands: {},
    }),
  );
  const live = process.env.JEV_LIVE;
  process.env.JEV_LIVE = "1";
  try {
    await assert.rejects(openApp(localConfig(dir, manifest)), /template/);
  } finally {
    if (live === undefined) delete process.env.JEV_LIVE;
    else process.env.JEV_LIVE = live;
    rmSync(dir, { recursive: true, force: true });
  }
});
