// apps/dna-server-api/scripts/judge-corpus.ts
// Training corpus for the local judge. export: capture JSONL -> one row per question with the exact prompt string.
// label: ask the teacher (27B on :1919, same raw-logprob path as the local backend) and append soft labels.
// Resumable: label skips keys already present in the output file.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { labelsFor, LocalJev, renderPrompt, TEMPLATE_SHA, type Question } from "@dna/jev";

export interface CorpusRow {
  key: string;
  command: string;
  version: number;
  item_id: number | null;
  question_id: string;
  type: Question["type"];
  labels: string[];
  prompt: string;
  template_sha: string;
}

export interface LabeledRow extends CorpusRow {
  teacher: { model: string; probs: number[]; mass: number };
}

type Distribution = (
  prompt: string,
  labels: string[],
) => Promise<{ probs: number[]; mass: number }>;

export function exportCorpus(captureLines: string[]): CorpusRow[] {
  const seen = new Set<string>();
  const rows: CorpusRow[] = [];
  for (const line of captureLines) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    for (const [question_id, q] of Object.entries(rec.questions as Record<string, Question>)) {
      const prompt = renderPrompt(rec.state, q);
      const key = createHash("sha256").update(prompt).digest("hex");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        key,
        command: rec.command,
        version: rec.version,
        item_id: rec.item_id ?? null,
        question_id,
        type: q.type,
        labels: labelsFor(q),
        prompt,
        template_sha: TEMPLATE_SHA,
      });
    }
  }
  return rows;
}

export async function* labelCorpus(
  rows: CorpusRow[],
  done: Set<string>,
  distribution: Distribution,
  model: string,
  onSkip?: (row: CorpusRow, error: unknown) => void,
): AsyncGenerator<LabeledRow> {
  for (const row of rows) {
    if (done.has(row.key)) continue;
    let answer: { probs: number[]; mass: number };
    try {
      answer = await distribution(row.prompt, row.labels);
    } catch (error) {
      // One prompt the teacher cannot answer (e.g. all labels outside its top 50) must not stop a multi-hour run,
      // or block every resume on the same row.
      onSkip?.(row, error);
      continue;
    }
    yield { ...row, teacher: { model, probs: answer.probs, mass: answer.mass } };
  }
}

const readLines = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { "base-url": { type: "string" }, model: { type: "string" } },
  });
  const [cmd, input, output] = positionals;
  if (cmd === "export" && input && output) {
    const rows = exportCorpus(readLines(input));
    writeFileSync(output, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`exported ${rows.length} questions to ${output}`);
    return;
  }
  if (cmd === "label" && input && output) {
    const model = values.model ?? "Qwen3.8-27B-gsq-iq3xxs";
    // The teacher is untrained on our labels, so no mass floor and no temperature: store what it said.
    const teacher = new LocalJev({
      baseUrl: values["base-url"] ?? "http://127.0.0.1:1919",
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
    const rows = readLines(input).map((l) => JSON.parse(l) as CorpusRow);
    const skipFile = `${output}.skipped.jsonl`;
    const skippedBefore = readLines(skipFile).map((l) => JSON.parse(l).key as string);
    const done = new Set([
      ...readLines(output).map((l) => JSON.parse(l).key as string),
      ...skippedBefore,
    ]);
    let n = 0;
    let skipped = 0;
    const onSkip = (row: CorpusRow, error: unknown) => {
      skipped++;
      appendFileSync(
        skipFile,
        `${JSON.stringify({ key: row.key, command: row.command, error: String(error).slice(0, 300) })}\n`,
      );
    };
    for await (const row of labelCorpus(
      rows,
      done,
      (p, l) => teacher.distribution(p, l),
      model,
      onSkip,
    )) {
      appendFileSync(output, `${JSON.stringify(row)}\n`);
      if (++n % 100 === 0) console.log(`labeled ${n + done.size}/${rows.length}`);
    }
    console.log(`done: ${n} new, ${done.size} resumed, ${skipped} skipped (see ${skipFile})`);
    return;
  }
  console.error(
    "usage: judge-corpus.ts export <capture.jsonl> <corpus.jsonl> | label <corpus.jsonl> <labeled.jsonl> [--base-url URL] [--model NAME]",
  );
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
