// apps/dna-server-api/tests/judge-ssot.test.ts
// The SSOT gate for the judge attachment, next to judge-config.test.ts:
// judge.yaml (manifest_path, version, policy) must agree with config.ts, the
// eval script, .env.example and the injection command. A manifest path that
// does not resolve is red.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadCommand } from "@dna/jev";
import { loadConfig } from "../src/config.ts";
import { judgeManifestPath, loadJudgeManifest, loadJudgeSsot } from "../src/news/judge-ssot.ts";

const API_DIR = resolve(import.meta.dirname, "..");
const ROOT = resolve(API_DIR, "../..");

const envDefault = (key: string): string => {
  const m = readFileSync(join(ROOT, ".env.example"), "utf8").match(
    new RegExp(`^#?\\s*${key}=(\\S+)?`, "m"),
  );
  assert.ok(m, `${key} is not mentioned in .env.example`);
  return (m[1] ?? "").trim();
};

const commandPolicy = () =>
  (loadCommand("injection", join(API_DIR, "prompt_engineering/jev")).policy ?? {}) as Record<
    string,
    unknown
  >;

test("judge.yaml names the same manifest path as config, the eval script and .env.example", () => {
  const ssot = loadJudgeSsot();
  const dir = mkdtempSync(join(tmpdir(), "dna-jssot-"));
  try {
    const fromConfig = loadConfig([], {
      ...process.env,
      DNA_PROVIDER: "faux",
      DNA_SEARCH_MODE: "fixture",
      DNA_DATA_DIR: dir,
    }).jevManifest;
    assert.equal(ssot.manifestPath, fromConfig);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const script = readFileSync(join(API_DIR, "scripts/judge-injection-eval.ts"), "utf8");
  assert.ok(
    script.includes(`"${ssot.manifestPath}"`),
    `judge-injection-eval.ts names another default than judge.yaml`,
  );
  assert.equal(envDefault("JEV_MANIFEST"), ssot.manifestPath);
});

test("judge.yaml policy matches the injection command", () => {
  const ssot = loadJudgeSsot();
  const policy = commandPolicy();
  assert.equal(ssot.policy.reject_min, policy.reject_min);
  assert.equal(ssot.policy.allow_max, policy.allow_max);
});

test("Env beats judge.yaml when resolving the manifest path", () => {
  const ssot = loadJudgeSsot();
  assert.equal(judgeManifestPath({}, ssot), ssot.manifestPath);
  assert.equal(
    judgeManifestPath({ JEV_MANIFEST: "/tmp/custom/manifest.json" }, ssot),
    "/tmp/custom/manifest.json",
  );
});

function fixtureManifest(dir: string, name = "news-judge") {
  const path = join(dir, "manifest.json");
  writeFileSync(
    path,
    JSON.stringify({
      name,
      version: "test-1",
      gguf: "test.gguf",
      base_model: "test-base",
      temperature: 1,
      min_mass: 0.5,
      template_sha: "0".repeat(64),
      commands: {},
    }),
  );
  return path;
}

test("Env -> file -> version: a matching manifest loads, a missing path is red", () => {
  const dir = mkdtempSync(join(tmpdir(), "dna-jssot-"));
  try {
    const ssot = loadJudgeSsot();
    const good = fixtureManifest(dir);
    const manifest = loadJudgeManifest({ JEV_MANIFEST: good }, ssot);
    assert.equal(manifest.version, "test-1");
    const missing = join(dir, "missing-manifest.json");
    assert.throws(() => loadJudgeManifest({ JEV_MANIFEST: missing }, ssot), /does not resolve/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a manifest trained for another judge name is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "dna-jssot-"));
  try {
    const ssot = loadJudgeSsot();
    const other = fixtureManifest(dir, "other-judge");
    assert.throws(() => loadJudgeManifest({ JEV_MANIFEST: other }, ssot), /expects/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
