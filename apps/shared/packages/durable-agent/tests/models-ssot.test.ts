// apps/shared/packages/durable-agent/tests/models-ssot.test.ts
// The SSOT gate for models.yaml: the catalog file next to src/models.ts must
// match CATALOG + DEFAULT_MODEL, and every model the env can select (the DNA_*
// choices in the root .env.example) must be in that catalog. An unknown model
// is red: catalog.ref throws.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { CATALOG, createModelCatalog, DEFAULT_MODEL, FAUX_MODEL } from "../src/index.ts";

const DIR = resolve(import.meta.dirname, "..");
const ROOT = resolve(DIR, "../../../..");

interface ModelsYaml {
  default: string;
  faux: string;
  catalog: string[];
  slots: Record<string, Record<string, string>>;
}

function loadYaml(): ModelsYaml {
  return parse(readFileSync(join(DIR, "models.yaml"), "utf8")) as ModelsYaml;
}

/** Every active (uncommented) `KEY=value` model choice in .env.example. */
function envModelChoices(): { key: string; value: string }[] {
  const keys = new Set([
    "DNA_MODEL",
    "DNA_RESEARCH_MODEL",
    "DNA_FALLBACK_MODEL",
    "DNA_HELPER_MODEL",
    "DNA_LOCAL_MODEL",
    "DNA_INVESTIGATE_FALLBACK_MODEL",
  ]);
  return readFileSync(join(ROOT, ".env.example"), "utf8")
    .split("\n")
    .map((line) => line.match(/^(DNA_[A-Z_]*MODEL)\s*=\s*(\S+)?/))
    .filter((m): m is RegExpMatchArray => m !== null && keys.has(m[1]))
    .map((m) => ({ key: m[1], value: (m[2] ?? "").trim() }));
}

/** Every model-looking assignment, active or commented, must at least have a slot. */
function allMentionedModelKeys(): string[] {
  const keys = new Set([
    "DNA_MODEL",
    "DNA_RESEARCH_MODEL",
    "DNA_FALLBACK_MODEL",
    "DNA_HELPER_MODEL",
    "DNA_LOCAL_MODEL",
    "DNA_INVESTIGATE_FALLBACK_MODEL",
  ]);
  return readFileSync(join(ROOT, ".env.example"), "utf8")
    .split("\n")
    .map((line) => line.match(/^#?\s*(DNA_[A-Z_]*MODEL)\s*=/))
    .filter((m): m is RegExpMatchArray => m !== null && keys.has(m[1]))
    .map((m) => m[1]);
}

test("models.yaml mirrors CATALOG and DEFAULT_MODEL", () => {
  const ssot = loadYaml();
  assert.equal(ssot.default, DEFAULT_MODEL);
  assert.equal(ssot.faux, FAUX_MODEL);
  assert.deepEqual(ssot.catalog, CATALOG.map((c) => c.id));
});

test("every .env.example model choice is in the catalog or a local/hosted slot", () => {
  const ssot = loadYaml();
  const slotKeys = new Set(Object.values(ssot.slots).flatMap((s) => Object.keys(s)));
  for (const key of allMentionedModelKeys())
    assert.ok(slotKeys.has(key), `${key} has no slot in models.yaml`);
  for (const { key, value } of envModelChoices()) {
    if (ssot.slots.openrouter[key] !== "catalog") continue;
    assert.ok(value, `${key} is empty in .env.example`);
    assert.ok(
      ssot.catalog.includes(value),
      `${key}=${value} is not in the models.yaml catalog`,
    );
  }
});

test("an unknown model is red: the catalog refuses it", () => {
  const ssot = loadYaml();
  assert.ok(!ssot.catalog.includes("nope/not-a-model"));
  const catalog = createModelCatalog({ provider: "openrouter" });
  assert.throws(() => catalog.ref("nope/not-a-model"), /Unknown model/);
});
