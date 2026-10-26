// apps/shared/packages/durable-agent/tests/local-models.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createModelCatalog } from "../src/index.ts";

const local = {
  baseUrl: "http://127.0.0.1:1919/v1",
  model: "qwen3.8-27b-gsq-rco-iq2s",
  contextWindow: 139264,
};

test("local catalog exposes one free model at the configured endpoint", () => {
  const catalog = createModelCatalog({ provider: "local", local });
  assert.equal(catalog.provider, "local");
  assert.deepEqual(catalog.defaultModel, { provider: "local", modelId: local.model });
  const [info] = catalog.list();
  assert.equal(catalog.list().length, 1);
  assert.equal(info.contextWindow, 139264);
  assert.deepEqual(info.cost, { input: 0, output: 0 });
});

test("local catalog rejects unknown ids", () => {
  const catalog = createModelCatalog({ provider: "local", local });
  assert.throws(() => catalog.ref("anthropic/claude-haiku-5.5"), /Unknown model/);
});

test("local catalog requires local options", () => {
  assert.throws(() => createModelCatalog({ provider: "local" }), /needs local options/);
});

const fallback = {
  baseUrl: "https://api.meta.ai/v1",
  model: "muse-spark-1.3-contributor",
  contextWindow: 153600,
  apiKeyEnv: ["DNA_FALLBACK_API_KEY"],
  cost: { input: 0.1, output: 0.2 },
};

test("a local catalog with a fallback serves both models, each from its own provider", () => {
  const catalog = createModelCatalog({ provider: "local", local: { ...local, fallback } });
  assert.deepEqual(catalog.defaultModel, { provider: "local", modelId: local.model });
  assert.deepEqual(
    catalog.list().map((m) => [m.id, m.provider]),
    [
      [local.model, "local"],
      [fallback.model, "fallback"],
    ],
  );
  assert.deepEqual(catalog.ref(fallback.model), { provider: "fallback", modelId: fallback.model });
  assert.deepEqual(catalog.info(fallback.model)?.cost, { input: 0.1, output: 0.2 });
});

test("a fallback can speak the Responses API and send its own headers", () => {
  const headers = { "x-opencode-session": "dna-cluster" };
  const catalog = createModelCatalog({
    provider: "local",
    local: { ...local, fallback: { ...fallback, api: "openai-responses", headers } },
  });
  const model = catalog.models.getModel("fallback", fallback.model);
  assert.equal(model?.api, "openai-responses");
  assert.deepEqual(model?.headers, headers);
});
