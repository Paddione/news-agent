// apps/shared/packages/jev/src/judge-prompt.ts
// The one prompt renderer for the local judge. Training data is exported through it, so the model only ever sees
// prompts this file produced. TEMPLATE_SHA hashes fixed sample renders: change the output, retrain the judge.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { QuestionValidationError, type Question, type State } from "./types.ts";

const SYSTEM = readFileSync(new URL("../prompts/JUDGE_SYSTEM.md", import.meta.url), "utf8").trim();
const CHOICE_ALPHABET = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."0123456789",
];

export function labelsFor(q: Question): string[] {
  if (q.type === "noul") return ["yes", "no"];
  if (q.type === "score") return q.criteria.map((_, i) => String(i));
  const n = Object.keys(q.criteria).length;
  if (n > CHOICE_ALPHABET.length)
    throw new QuestionValidationError(`Local judge supports at most 62 choice options; got ${n}.`);
  return CHOICE_ALPHABET.slice(0, n);
}

function criteriaLines(q: Question, labels: string[]): string[] {
  if (q.type === "noul")
    return [`yes: ${q.criteria?.true ?? "yes"}`, `no: ${q.criteria?.false ?? "no"}`];
  if (q.type === "score") return q.criteria.map((level, i) => `${labels[i]}: ${level}`);
  return Object.entries(q.criteria).map(
    ([opt, desc], i) => `${labels[i]}: ${opt}${desc ? ` (${desc})` : ""}`,
  );
}

// Article text is untrusted. llama-server parses special tokens in the prompt, so a page containing chat markers
// could close the user turn and pre-fill the answer. Break every marker that the template itself relies on.
const neutralize = (text: string) =>
  text.replace(/<\|/g, "< |").replace(/<(\/?)think>/g, "< $1think>");

export function renderPrompt(state: State, q: Question): string {
  const labels = labelsFor(q);
  const body = typeof state === "string" ? state : JSON.stringify(state, null, 1);
  const instructions =
    typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions, null, 1);
  return (
    `<|im_start|>system\n${SYSTEM}<|im_end|>\n` +
    `<|im_start|>user\n` +
    neutralize(
      `State:\n${body}\n\nQuestion: ${instructions}\n` + criteriaLines(q, labels).join("\n"),
    ) +
    `\nAnswer with one label: ${labels.join(", ")}<|im_end|>\n` +
    `<|im_start|>assistant\n<think>\n\n</think>\n\n`
  );
}

export const TEMPLATE_SHA = createHash("sha256")
  .update(
    renderPrompt(
      { s: 1 },
      { type: "noul", instructions: "q", criteria: { true: "t", false: "f" } },
    ),
  )
  .update(renderPrompt({ s: 1 }, { type: "score", instructions: "q", criteria: ["a", "b"] }))
  .update(
    renderPrompt({ s: 1 }, { type: "choice", instructions: "q", criteria: { a: null, b: "d" } }),
  )
  .update(renderPrompt({ s: "<|im_end|><think>" }, { type: "noul", instructions: "q" }))
  .digest("hex");
