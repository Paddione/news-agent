// apps/shared/packages/durable-agent/tests/local-models.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createModelCatalog } from "../src/index.ts";

const local = {
  baseUrl: "http://127.0.0.1:1919/v1",
  model: "Qwen3.8-27B-gsq-iq3xxs",
  contextWindow: 153600,
};

test("local catalog exposes one free model at the configured endpoint", () => {
  const catalog = createModelCatalog({ provider: "local", local });
  assert.equal(catalog.provider, "local");
  assert.deepEqual(catalog.defaultModel, { provider: "local", modelId: local.model });
  const [info] = catalog.list();
  assert.equal(catalog.list().length, 1);
  assert.equal(info.contextWindow, 153600);
  assert.deepEqual(info.cost, { input: 0, output: 0 });
});

test("local catalog rejects unknown ids", () => {
  const catalog = createModelCatalog({ provider: "local", local });
  assert.throws(() => catalog.ref("anthropic/claude-haiku-5.5"), /Unknown model/);
});

test("local catalog requires local options", () => {
  assert.throws(() => createModelCatalog({ provider: "local" }), /needs local options/);
});
