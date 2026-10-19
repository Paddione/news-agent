// apps/dna-server-api/tests/judge-corpus.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { TEMPLATE_SHA } from "@dna/jev";
import { exportCorpus, labelCorpus } from "../scripts/judge-corpus.ts";

const cap = (item: number) =>
  JSON.stringify({
    command: "hfs",
    version: 2,
    item_id: item,
    state: { title: `t${item}` },
    questions: {
      hype: { type: "score", instructions: "h", criteria: ["a", "b", "c", "d"] },
      ok: { type: "noul", instructions: "o" },
    },
  });

test("export writes one row per question and dedupes identical prompts", () => {
  const rows = exportCorpus([cap(1), cap(1), cap(2)]);
  assert.equal(rows.length, 4);
  const hype = rows.find((r) => r.item_id === 1 && r.question_id === "hype")!;
  assert.deepEqual(hype.labels, ["0", "1", "2", "3"]);
  assert.equal(hype.type, "score");
  assert.equal(hype.template_sha, TEMPLATE_SHA);
  assert.match(hype.key, /^[0-9a-f]{64}$/);
});

test("label skips rows already done and records teacher probs and mass", async () => {
  const rows = exportCorpus([cap(1)]);
  const done = new Set([rows[0].key]);
  const out = [];
  for await (const r of labelCorpus(
    rows,
    done,
    async (_p, labels) => ({ probs: labels.map(() => 1 / labels.length), mass: 0.95 }),
    "teacher-x",
  ))
    out.push(r);
  assert.equal(out.length, 1);
  assert.equal(out[0].teacher.model, "teacher-x");
  assert.equal(out[0].teacher.mass, 0.95);
});
