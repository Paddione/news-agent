import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { LocalJev, renderCommand, renderPrompt, labelsFor, TEMPLATE_SHA } from "@dna/jev";

const JEV_DIR = "/home/patrick/news-agent/apps/dna-server-api/prompt_engineering/jev";
const command = JSON.parse(readFileSync(`${JEV_DIR}/injection/command.json`, "utf8"));

const { values } = parseArgs({
  options: {
    corpus: { type: "string" },
    output: { type: "string" },
    "base-url": { type: "string" },
    model: { type: "string" },
  },
});

const corpusPath = values.corpus ?? "/home/patrick/unsloth-boxes/news-judge-train/corpus/injection/v3.jsonl";
const outPath = values.output ?? "/home/patrick/unsloth-boxes/news-judge-train/corpus/injection/v3-labeled.jsonl";
const baseUrl = values["base-url"] ?? "http://127.0.0.1:8010";
const model = values.model ?? "qwen3.8-27b-gsq-rco-iq2s";

const teacher = new LocalJev({
  baseUrl,
  manifest: {
    name: "teacher",
    version: model,
    gguf: "",
    base_model: model,
    temperature: 1,
    min_mass: 0,
    template_sha: TEMPLATE_SHA,
    commands: {},
  },
  timeoutMs: 120_000,
});
await teacher.init();

const rows = readFileSync(corpusPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const done = new Set(existsSync(outPath) ? readFileSync(outPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).key) : []);

let n = 0;
for (const row of rows) {
  const rendered = renderCommand(command, { title: row.title, source: row.source, excerpt: row.text });
  const q = rendered.questions.injection;
  const prompt = renderPrompt(rendered.state, q);
  const labels = ["yes", "no"];
  const key = row.id; // use id as key
  if (done.has(key)) { console.log(`skip ${key}`); continue; }
  let answer;
  try {
    answer = await teacher.distribution(prompt, labels);
  } catch (e) {
    console.error(`FAIL ${key}: ${e}`);
    continue;
  }
  const out = {
    key: row.id,
    command: "injection",
    version: 1,
    item_id: null,
    question_id: "injection",
    type: "noul",
    labels: ["yes", "no"],
    prompt,
    template_sha: TEMPLATE_SHA,
    id: row.id,
    label: row.label,
    title: row.title,
    source: row.source,
    text: row.text,
    teacher: { model, probs: answer.probs, mass: answer.mass },
  };
  appendFileSync(outPath, JSON.stringify(out) + "\n");
  n++;
  if (n % 10 === 0) console.log(`labeled ${n}/${rows.length}`);
}
console.log(`done: ${n} new`);