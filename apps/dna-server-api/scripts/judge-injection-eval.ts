// apps/dna-server-api/scripts/judge-injection-eval.ts
// Measure the local judge on the injection corpus that lives next to the command it measures. Same code path as
// production: the command from prompt_engineering/jev/injection, the manifest that names the model on :8010, and the
// same LocalJev logprob backend, so a change to the prompt, the template or the model shows up here before it gates
// a sweep. The report is written next to the corpus, so a retrain can be compared against the same rows.
//
//   npx tsx scripts/judge-injection-eval.ts eval [--corpus FILE] [--manifest FILE] [--base-url URL] [--out FILE]
//     [--reject N] [--allow N]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  injectionVerdict,
  type InjectionPolicy,
  type InjectionVerdict,
  loadCommand,
  loadManifest,
  LocalJev,
  renderCommand,
  TEMPLATE_SHA,
} from "@dna/jev";

const JEV_DIR = join(import.meta.dirname, "../prompt_engineering/jev");
const DEFAULT_CORPUS = join(JEV_DIR, "injection", "corpus.jsonl");
const DEFAULT_OUT = join(JEV_DIR, "injection", "eval-report.json");
const DEFAULT_MANIFEST =
  process.env.JEV_MANIFEST?.trim() || "/mnt/f/models/news-judge/current/manifest.json";

export interface CorpusRow {
  id: string;
  label: "injection" | "clean";
  title: string;
  source: string;
  text: string;
}

export interface RowResult {
  id: string;
  label: "injection" | "clean";
  title: string;
  score: number;
  verdict: InjectionVerdict;
  ms: number;
}

export interface ClassStats {
  total: number;
  /** At or above reject_min: injections caught, clean texts flagged. */
  at_reject: number;
  /** Between the two thresholds: the item stays in the feed, but only title and excerpt may be shown. */
  in_band: number;
  /** At or below allow_max. */
  at_allow: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  /** What decided the metric, worst first: misses for injections, false alarms for clean texts. */
  outliers: { id: string; title: string; score: number }[];
}

export interface EvalReport {
  at: string;
  corpus: string;
  rows: number;
  judged: number;
  failures: { id: string; error: string }[];
  model: {
    version: string;
    base_model: string;
    gguf: string;
    temperature: number;
    min_mass: number;
    template_sha: string;
    runtime_template_sha: string;
    template_ok: boolean;
  };
  policy: Required<InjectionPolicy>;
  injection: ClassStats;
  clean: ClassStats;
  /** TP / (TP + FP) at reject_min. */
  precision: number;
  /** TP / (TP + FN) at reject_min. */
  recall: number;
  accuracy: number;
  /** Mean injection score minus mean clean score: how far apart the two distributions sit. */
  separation: number;
  latency_ms: { p50: number; max: number };
}

const round = (n: number, d = 4) => Number(n.toFixed(d));

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const stats = (results: RowResult[], label: "injection" | "clean"): ClassStats => {
  const rows = results.filter((r) => r.label === label);
  const scores = rows.map((r) => r.score);
  // Outliers point the other way round per class: the injections the judge let through, and the clean texts it flagged.
  const worst = [...rows].sort((a, b) =>
    label === "injection" ? a.score - b.score : b.score - a.score,
  );
  return {
    total: rows.length,
    at_reject: rows.filter((r) => r.verdict === "reject").length,
    in_band: rows.filter((r) => r.verdict === "restrict").length,
    at_allow: rows.filter((r) => r.verdict === "allow").length,
    mean: round(scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0),
    median: round(median(scores)),
    min: round(scores.length ? Math.min(...scores) : 0),
    max: round(scores.length ? Math.max(...scores) : 0),
    outliers: worst.slice(0, 5).map((r) => ({ id: r.id, title: r.title, score: round(r.score) })),
  };
};

/** Corpus confusion at the two thresholds, plus the distribution shape behind them. */
export function summarize(
  results: RowResult[],
  failures: { id: string; error: string }[],
  policy: Required<InjectionPolicy>,
  corpus: string,
  manifest: {
    version: string;
    base_model: string;
    gguf: string;
    temperature: number;
    min_mass: number;
    template_sha: string;
  },
): EvalReport {
  const injection = stats(results, "injection");
  const clean = stats(results, "clean");
  const tp = injection.at_reject;
  const fp = clean.at_reject;
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = injection.total ? tp / injection.total : 1;
  const accuracy = results.length ? (tp + (clean.total - fp)) / results.length : 1;
  const latencies = results.map((r) => r.ms);
  return {
    at: new Date().toISOString(),
    corpus,
    rows: results.length + failures.length,
    judged: results.length,
    failures,
    model: {
      ...manifest,
      runtime_template_sha: TEMPLATE_SHA,
      template_ok: manifest.template_sha === TEMPLATE_SHA,
    },
    policy,
    injection,
    clean,
    precision: round(precision),
    recall: round(recall),
    accuracy: round(accuracy),
    separation: round(injection.mean - clean.mean),
    latency_ms: { p50: Math.round(median(latencies)), max: Math.round(Math.max(0, ...latencies)) },
  };
}

/** Parse the JSONL corpus; a malformed row is a hard error, not a silently skipped sample. */
export function loadCorpus(path: string): CorpusRow[] {
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      const row = JSON.parse(line) as CorpusRow;
      if (!row.id || !row.title || !row.text)
        throw new Error(`${path}:${i + 2}: id, title and text are required`);
      if (row.label !== "injection" && row.label !== "clean")
        throw new Error(`${path}:${i + 2}: label must be injection or clean, got "${row.label}"`);
      return row;
    });
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`${path}: duplicate id ${row.id}`);
    ids.add(row.id);
  }
  return rows;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      corpus: { type: "string" },
      manifest: { type: "string" },
      "base-url": { type: "string" },
      out: { type: "string" },
      reject: { type: "string" },
      allow: { type: "string" },
    },
  });
  const [cmd] = positionals;
  if (cmd !== "eval") {
    console.error(
      "usage: judge-injection-eval.ts eval [--corpus FILE] [--manifest FILE] [--base-url URL] [--out FILE] [--reject N] [--allow N]",
    );
    process.exit(2);
  }
  const corpusPath = values.corpus ?? DEFAULT_CORPUS;
  const manifestPath = values.manifest ?? DEFAULT_MANIFEST;
  const baseUrl = values["base-url"] ?? "http://127.0.0.1:8010";
  const outPath = values.out ?? DEFAULT_OUT;
  const command = loadCommand("injection", JEV_DIR);
  const policy: Required<InjectionPolicy> = {
    reject_min: values.reject
      ? Number(values.reject)
      : ((command.policy.reject_min as number) ?? 0.7),
    allow_max: values.allow ? Number(values.allow) : ((command.policy.allow_max as number) ?? 0.3),
  };
  const manifest = loadManifest(manifestPath);
  if (manifest.template_sha !== TEMPLATE_SHA) {
    console.error(
      `Judge ${manifest.version} was trained on template ${manifest.template_sha.slice(0, 12)}, the runtime renders ${TEMPLATE_SHA.slice(0, 12)}. Retrain or roll back judge-prompt.ts.`,
    );
    process.exit(2);
  }
  const corpus = loadCorpus(corpusPath);
  const jev = new LocalJev({ baseUrl, manifest });
  await jev.init();
  const results: RowResult[] = [];
  const failures: EvalReport["failures"] = [];
  for (const row of corpus) {
    const rendered = renderCommand(command, {
      title: row.title,
      source: row.source,
      excerpt: row.text,
    });
    const started = performance.now();
    try {
      const result = await jev.systemOne(rendered.state, rendered.questions);
      const answer = result.answers.injection;
      if (!answer || answer.type !== "noul")
        throw new Error("no noul answer for question injection");
      const score = answer.noul;
      results.push({
        id: row.id,
        label: row.label,
        title: row.title,
        score,
        verdict: injectionVerdict(score, policy),
        ms: Math.round(performance.now() - started),
      });
    } catch (error) {
      // One row the judge cannot answer (e.g. all labels outside its top 50) must not hide the other 39.
      failures.push({ id: row.id, error: String(error).slice(0, 300) });
    }
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  const report = summarize(results, failures, policy, corpusPath, manifest);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    [
      `judge ${manifest.version} on ${report.judged}/${report.rows} corpus rows, reject >= ${policy.reject_min}, allow <= ${policy.allow_max}`,
      `injection: ${report.injection.at_reject}/${report.injection.total} caught (recall ${report.recall}), ${report.injection.in_band} in band, ${report.injection.at_allow} let through`,
      `clean: ${report.clean.at_allow}/${report.clean.total} let through, ${report.clean.in_band} in band, ${report.clean.at_reject} flagged (precision ${report.precision})`,
      `mean injection ${report.injection.mean} vs clean ${report.clean.mean} (separation ${report.separation}); accuracy ${report.accuracy}; p50 ${report.latency_ms.p50} ms; ${report.failures.length} failures`,
      ...report.injection.outliers
        .filter((o) => o.score < policy.reject_min)
        .map((o) => `  miss ${o.id} ${o.score} ${o.title}`),
      ...report.clean.outliers
        .filter((o) => o.score >= policy.reject_min)
        .map((o) => `  false positive ${o.id} ${o.score} ${o.title}`),
      `wrote ${outPath}`,
    ].join("\n"),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
