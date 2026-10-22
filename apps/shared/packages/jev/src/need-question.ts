// Issue need-gate question (design: .agents/plans/issue-need-gate/design.md).
// A `score` question over five levels of implementation need: how strongly the
// evidence says the issue should be implemented, not how severe it sounds.
// Normalized to 0..1 (score divided by 4); 0.7 clears the ready-to-plan gate.
import { score } from "./helpers.ts";
import type { ScoreAnswer, ScoreQuestion } from "./types.ts";

/** Version of the rubric below; bump when a level text changes. */
export const NEED_QUESTION_VERSION = 1;

/**
 * Score of 1 at or above this normalized value stages a plan. Precedent:
 * injection-judge 0.7. Probe 2026-10-22 (10 synthetic states, real judge):
 * group means rise monotonically (0.23/0.25/0.35/0.47/0.55) but the scale is
 * compressed — the clearest need scored 0.55. Recalibrate on 10 real
 * investigated issues with full evidence bundles before trusting or moving this.
 */
export const NEED_THRESHOLD = 0.7;

export const NEED_LEVELS = [
  "No need: nothing actionable is asked for, or the request is already satisfied; implementing anything would be churn.",
  "Weak need: a nice-to-have with no concrete use case; the value is speculative and workarounds are fine.",
  "Moderate need: a real gap with a plausible use case, but workarounds exist or nothing is urgent.",
  "Strong need: a concrete gap blocking real work with no good workaround; implementing it clearly pays off.",
  "Compelling need: a blocking or high-value gap backed by evidence; implementing it is clearly the right next step.",
] as const;

export function needQuestion(): ScoreQuestion {
  return score(
    "How strong is the need to implement what this issue asks for, given the report and the repository evidence? Judge implementation need, not severity or drama: a loud complaint with no actionable gap scores low, a quiet report of a blocking gap scores high.",
    [...NEED_LEVELS],
  );
}

/** Weighted score mapped to 0..1 across the levels (mirrors the `score` branch of answerFrom). */
export function needScore(answer: ScoreAnswer): number {
  const top = NEED_LEVELS.length - 1;
  if (top <= 0) return 0;
  return Math.min(1, Math.max(0, answer.score / top));
}

export type NeedVerdict = "ready" | "triage";

/** At or above threshold the issue may be planned; below it stays in triage. */
export function needVerdict(score01: number, threshold: number = NEED_THRESHOLD): NeedVerdict {
  return score01 >= threshold ? "ready" : "triage";
}
