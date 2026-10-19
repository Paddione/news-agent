// apps/shared/packages/jev/tests/local.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { answerFrom, LocalJev, type JudgeManifest } from "../src/local.ts";
import { ContractError } from "../src/client.ts";
import { TEMPLATE_SHA } from "../src/judge-prompt.ts";

const IDS: Record<string, number> = {
  yes: 9405,
  no: 2083,
  A: 32,
  B: 33,
  "0": 15,
  "1": 16,
  "2": 17,
};
const manifest = (over: Partial<JudgeManifest> = {}): JudgeManifest => ({
  name: "news-judge",
  version: "t",
  gguf: "x.gguf",
  base_model: "b",
  temperature: 1,
  min_mass: 0.5,
  template_sha: TEMPLATE_SHA,
  commands: {},
  ...over,
});

/** A fake llama-server: /tokenize maps label text to fixed ids, /completion returns the given top logprobs. */
function stub(top: Record<string, number>) {
  const calls: any[] = [];
  const fetchImpl = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith("/tokenize")) return Response.json({ tokens: [IDS[body.content]] });
    const top_logprobs = Object.entries(top).map(([token, p]) => ({
      id: IDS[token] ?? 999,
      token,
      logprob: Math.log(p),
    }));
    return Response.json({
      content: "x",
      completion_probabilities: [{ id: 1, token: "x", logprob: -1, top_logprobs }],
      tokens_evaluated: 120,
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("answerFrom maps distributions onto jev answers", () => {
  assert.deepEqual(answerFrom({ type: "noul", instructions: "q" }, [0.8, 0.2]), {
    type: "noul",
    noul: 0.8,
  });
  const s = answerFrom(
    { type: "score", instructions: "q", criteria: ["a", "b", "c"] },
    [0.2, 0.3, 0.5],
  );
  assert.equal(s.type, "score");
  if (s.type === "score") {
    assert.equal(s.score, 1.3);
    assert.deepEqual(s.legend, { "0": "a", "1": "b", "2": "c" });
    assert.equal(s.confidence, 0.5);
  }
  const c = answerFrom(
    { type: "choice", instructions: "q", criteria: { ai: null, rust: null } },
    [0.3, 0.7],
  );
  assert.equal(c.type === "choice" && c.choice, "rust");
});

test("systemOne renormalises raw label logprobs and treats missing labels as zero", async () => {
  const { fetchImpl, calls } = stub({ yes: 0.6, no: 0.2, Yes: 0.15 });
  const jev = new LocalJev({ baseUrl: "http://judge", manifest: manifest(), fetchImpl });
  await jev.init();
  const out = await jev.systemOne({ t: 1 }, { ok: { type: "noul", instructions: "q" } });
  assert.equal(out.answers.ok.type === "noul" && out.answers.ok.noul, 0.75);
  assert.equal(out.meta.provider, "local");
  assert.deepEqual(out.meta.cost, { amount: 0, source: "reported" });
  const completion = calls.find((c) => c.url.endsWith("/completion"));
  assert.equal(completion.body.n_probs, 50);
  assert.equal(completion.body.post_sampling_probs, false);
  assert.equal(completion.body.grammar, undefined);
});

test("a label missing from the top list gets probability zero", async () => {
  const { fetchImpl } = stub({ "0": 0.7, "1": 0.2 });
  const jev = new LocalJev({ baseUrl: "http://judge", manifest: manifest(), fetchImpl });
  await jev.init();
  const { probs } = await jev.distribution("p", ["0", "1", "2"]);
  assert.deepEqual(
    probs.map((p) => Number(p.toFixed(4))),
    [0.7778, 0.2222, 0],
  );
});

test("mass below min_mass is a ContractError, zero mass never divides", async () => {
  const low = new LocalJev({
    baseUrl: "http://judge",
    manifest: manifest({ min_mass: 0.9 }),
    fetchImpl: stub({ yes: 0.3, no: 0.1 }).fetchImpl,
  });
  await low.init();
  await assert.rejects(low.distribution("p", ["yes", "no"]), ContractError);
  const none = new LocalJev({
    baseUrl: "http://judge",
    manifest: manifest({ min_mass: 0 }),
    fetchImpl: stub({ The: 0.9 }).fetchImpl,
  });
  await none.init();
  await assert.rejects(none.distribution("p", ["yes", "no"]), ContractError);
});

test("init refuses a manifest trained on another template", async () => {
  const jev = new LocalJev({
    baseUrl: "http://judge",
    manifest: manifest({ template_sha: "0".repeat(64) }),
    fetchImpl: stub({}).fetchImpl,
  });
  await assert.rejects(jev.init(), /template/);
});

test("temperature from the manifest sharpens or flattens", async () => {
  const jev = new LocalJev({
    baseUrl: "http://judge",
    manifest: manifest({ temperature: 2 }),
    fetchImpl: stub({ yes: 0.8, no: 0.2 }).fetchImpl,
  });
  await jev.init();
  const { probs } = await jev.distribution("p", ["yes", "no"]);
  assert.equal(Number(probs[0].toFixed(4)), 0.6667); // sqrt(0.8)/(sqrt(0.8)+sqrt(0.2))
});
