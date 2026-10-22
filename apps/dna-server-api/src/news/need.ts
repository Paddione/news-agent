// Issue need-gate (design: .agents/plans/issue-need-gate/design.md).
// After an investigation finishes `done`, this builds a bounded evidence bundle
// through the codeGraph seam, scores it with the need question on the judge,
// and posts the score plus reason as an issue comment. Stale graphs and judge
// failures return `unknown` and are retried with a cap: never a low score.
import {
  NEED_THRESHOLD,
  needQuestion,
  needScore,
  needVerdict,
  type Decide,
  type ScoreAnswer,
  type State,
} from "@dna/jev";
import type { Logger } from "@dna/sdk/node";
import type { CodeGraph } from "./graph.ts";
import type { IssueTracker } from "./issues.ts";

/** Label staged for planning once the need score clears the threshold. */
export const NEED_LABEL = "ready-to-plan";

/** Retries for a down judge or a stale graph before reporting `unknown`. */
export const NEED_MAX_ATTEMPTS = 3;

/** Bounds keep the judge state small; mirror the clipping style of graph.ts. */
export const REPORT_MAX = 4000;
export const EXCERPT_MAX = 2000;
export const NEED_EVIDENCE_TERM_CAP = 3;

const clip = (text: string | undefined, max: number) =>
  !text ? "" : text.length > max ? `${text.slice(0, max)} [${text.length - max} more chars]` : text;

export interface NeedReceipt {
  project: string;
  refreshedAt: string;
}

export interface NeedEvidence {
  project: string;
  report: string;
  targets: string[];
  overview: string;
  symbols: string[];
  searches: string[];
  receipt: NeedReceipt;
}

export type NeedBundle =
  | { status: "ready"; evidence: NeedEvidence }
  | { status: "unknown"; reason: string };

export interface NeedBundleInput {
  project: string;
  reportMd: string;
  targets: string[];
  terms: string[];
  now?: () => string;
}

/** Refresh-before-read bundle: report, targets, clipped graph excerpts, index receipt. */
export async function buildNeedBundle(
  graph: CodeGraph,
  input: NeedBundleInput,
): Promise<NeedBundle> {
  const now = input.now ?? (() => new Date().toISOString());
  let roots: { name: string; root: string }[];
  try {
    roots = await graph.projects();
  } catch (error) {
    return { status: "unknown", reason: `graph projects failed: ${String(error).slice(0, 200)}` };
  }
  const entry = roots.find((p) => p.name === input.project);
  if (!entry) {
    return {
      status: "unknown",
      reason: `no index receipt for project "${input.project}" (not indexed or outside the allow-list)`,
    };
  }
  try {
    await graph.refresh(entry.root);
  } catch (error) {
    return {
      status: "unknown",
      reason: `stale index receipt for "${input.project}": refresh failed: ${String(error).slice(0, 200)}`,
    };
  }
  const receipt: NeedReceipt = { project: input.project, refreshedAt: now() };
  const read = async (kind: string, fn: () => Promise<string>): Promise<string> => {
    try {
      return clip(await fn(), EXCERPT_MAX);
    } catch (error) {
      throw new Error(`${kind} read failed: ${String(error).slice(0, 200)}`);
    }
  };
  try {
    const terms = input.terms.slice(0, NEED_EVIDENCE_TERM_CAP);
    const overview = await read("overview", () => graph.overview(input.project));
    const symbols: string[] = [];
    const searches: string[] = [];
    for (const term of terms) {
      // Search is the primary read: it proves the graph is alive, so its
      // failure means unknown. A failing symbol lookup with a working search
      // is missing evidence (e.g. no indexed symbol for the term), not a
      // stale graph, so it degrades to an empty excerpt.
      searches.push(await read(`search "${term}"`, () => graph.search(input.project, term)));
      try {
        symbols.push(clip(await graph.symbol(input.project, term), EXCERPT_MAX));
      } catch {
        symbols.push(`(no symbol excerpt for "${term}")`);
      }
    }
    return {
      status: "ready",
      evidence: {
        project: input.project,
        report: clip(input.reportMd, REPORT_MAX),
        targets: input.targets,
        overview,
        symbols,
        searches,
        receipt,
      },
    };
  } catch (error) {
    return { status: "unknown", reason: String(error instanceof Error ? error.message : error) };
  }
}

export type NeedEvaluation =
  | { status: "scored"; score: number; verdict: "ready" | "triage"; reason: string }
  | { status: "unknown"; reason: string };

function topLevelText(answer: ScoreAnswer): string {
  let best = "0";
  let bestProb = -1;
  for (const [level, prob] of Object.entries(answer.probabilities)) {
    if (prob > bestProb) {
      bestProb = prob;
      best = level;
    }
  }
  return answer.legend?.[best] ?? best;
}

/** Judge call: the need question over the evidence state, normalized to 0..1. */
export async function evaluateNeed(
  decide: Decide,
  evidence: NeedEvidence,
): Promise<NeedEvaluation> {
  const state: State = {
    report: evidence.report,
    targets: evidence.targets,
    project: evidence.project,
    overview: evidence.overview,
    symbols: evidence.symbols,
    searches: evidence.searches,
    receipt: evidence.receipt,
  };
  const result = await decide(state, { need: needQuestion() });
  const answer = result.answers?.need;
  if (!answer || answer.type !== "score") {
    return { status: "unknown", reason: "judge returned no score answer for the need question" };
  }
  const score = needScore(answer);
  const verdict = needVerdict(score);
  const reason = `Need-Score ${score.toFixed(2)} (Schwelle ${NEED_THRESHOLD.toFixed(2)}): ${topLevelText(answer)}.`;
  return { status: "scored", score, verdict, reason };
}

export interface NeedGateDeps {
  issues: IssueTracker;
  graph: CodeGraph;
  decide: Decide;
  allowed: string[];
  log?: Logger;
}

export interface NeedGateInput {
  repo: string;
  number: number;
  title: string;
  reportMd: string;
  targets: string[];
}

export type NeedGateOutcome =
  | { status: "ready"; score: number; reason: string; commentUrl: string }
  | { status: "triage"; score: number; reason: string; commentUrl: string }
  | { status: "unknown"; reason: string }
  | { status: "skipped"; reason: string };

/** Short search terms from an issue title (mirrors titleTerms in investigate.ts). */
export function needTerms(title: string): string[] {
  const words = title
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  return words.slice(0, Math.min(Math.max(words.length, 3), 5));
}

function renderNeedComment(
  scored: { score: number; reason: string },
  evidence: NeedEvidence,
): string {
  return [
    scored.reason,
    "",
    `Evidenz: Graph-Projekt ${evidence.project} (Stand ${evidence.receipt.refreshedAt}), Targets: ${evidence.targets.join(", ") || "keine"}.`,
    scored.score >= NEED_THRESHOLD
      ? `Schwelle erreicht — \`${NEED_LABEL}\` wurde gesetzt, ein Plan darf gestagt werden.`
      : "Unter der Schwelle — kein Label, das Issue bleibt in der Triage.",
  ].join("\n");
}

/**
 * Score one investigated issue and record the result on it. Retry a down judge
 * or a stale graph up to NEED_MAX_ATTEMPTS, then comment the failure without
 * scoring: `unknown` is never reported as 0.
 */
export async function runNeedGate(
  deps: NeedGateDeps,
  input: NeedGateInput,
): Promise<NeedGateOutcome> {
  const project = input.targets.find((t) => deps.allowed.includes(t));
  if (!project) {
    return {
      status: "skipped",
      reason: `no graph-backed target in [${input.targets.join(", ")}]`,
    };
  }
  const terms = needTerms(input.title);
  let lastError = "";
  for (let attempt = 1; attempt <= NEED_MAX_ATTEMPTS; attempt++) {
    const bundle = await buildNeedBundle(deps.graph, {
      project,
      reportMd: input.reportMd,
      targets: input.targets,
      terms,
    });
    if (bundle.status === "unknown") {
      lastError = bundle.reason;
      continue;
    }
    try {
      const scored = await evaluateNeed(deps.decide, bundle.evidence);
      if (scored.status === "unknown") {
        lastError = scored.reason;
        continue;
      }
      const commentUrl = await deps.issues.comment(
        input.number,
        renderNeedComment(scored, bundle.evidence),
      );
      if (scored.verdict === "ready") {
        await deps.issues.addLabels(input.number, [NEED_LABEL]);
      }
      return { status: scored.verdict, score: scored.score, reason: scored.reason, commentUrl };
    } catch (error) {
      lastError = String(error instanceof Error ? error.message : error).slice(0, 300);
      deps.log?.warn("need_gate.attempt_failed", {
        repo: input.repo,
        number: input.number,
        attempt,
        error: lastError,
      });
    }
  }
  const failure =
    `Need-Bewertung fehlgeschlagen (Versuch ${NEED_MAX_ATTEMPTS}/${NEED_MAX_ATTEMPTS}): ${lastError}. ` +
    "Kein Score vergeben, das Issue bleibt in der Triage.";
  try {
    await deps.issues.comment(input.number, failure);
  } catch {}
  return { status: "unknown", reason: lastError };
}
