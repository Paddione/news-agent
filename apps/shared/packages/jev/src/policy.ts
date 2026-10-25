/**
 * Code decides thresholds; jev decides judgments. These helpers turn answers into numbers
 * the app ranks and gates on.
 */
import type { Answer, ChoiceAnswer, ScoreAnswer } from "./types.ts";

export type HfsCategory = "hype" | "facts" | "signal";
export const HFS: readonly HfsCategory[] = ["hype", "facts", "signal"];

export interface HfsRank {
  category: HfsCategory;
  /** 0 to 100 */
  score: number;
  confidence: number;
}

export interface HfsResult {
  ranked: HfsRank[];
  primary: HfsCategory;
  labels: HfsCategory[];
  scores: Record<HfsCategory, number>;
  /** Hype and signal without facts: rare and untrusted. */
  suspectCombo: boolean;
}

export interface HfsPolicy {
  label_threshold?: number;
  /** Per-category override of label_threshold: a category whose score runs low can still earn its label. */
  label_thresholds?: Partial<Record<HfsCategory, number>>;
  tie_order?: HfsCategory[];
}

export interface AttentionWeights {
  signal: number;
  facts: number;
  hype: number;
  relevance: number;
}

export const DEFAULT_ATTENTION: AttentionWeights = {
  signal: 0.5,
  facts: 0.35,
  hype: -0.25,
  relevance: 0.4,
};

/** Score position mapped to 0..1 across its levels (level03/normalize.ts). */
export function normalized(answer: ScoreAnswer): number {
  const top = Object.keys(answer.legend ?? answer.probabilities).length - 1;
  return top <= 0 ? 0 : Math.min(1, Math.max(0, answer.score / top));
}

export function asScore(answer: Answer | undefined, id: string): ScoreAnswer {
  if (!answer || answer.type !== "score") throw new Error(`Expected a score answer for "${id}"`);
  return answer;
}

/** Always ranks all three categories, highest first, ties broken by tie_order. */
export function rankHfs(answers: Record<string, Answer>, policy: HfsPolicy = {}): HfsResult {
  const base = policy.label_threshold ?? 50;
  const threshold = (c: HfsCategory) => policy.label_thresholds?.[c] ?? base;
  const order = policy.tie_order ?? ["signal", "facts", "hype"];
  const ranked = HFS.map((category) => {
    const answer = asScore(answers[category], category);
    return { category, score: Math.round(normalized(answer) * 100), confidence: answer.confidence };
  }).sort((a, b) => b.score - a.score || order.indexOf(a.category) - order.indexOf(b.category));
  const scores = Object.fromEntries(ranked.map((r) => [r.category, r.score])) as Record<
    HfsCategory,
    number
  >;
  return {
    ranked,
    primary: ranked[0].category,
    labels: ranked.filter((r) => r.score >= threshold(r.category)).map((r) => r.category),
    scores,
    suspectCombo:
      scores.hype >= threshold("hype") &&
      scores.signal >= threshold("signal") &&
      scores.facts < threshold("facts"),
  };
}

/**
 * 0 to 100. Signal plus facts ranks highest, pure hype lowest (hype carries a negative weight).
 * Normalized between the sum of negative weights and the sum of positive weights.
 */
export function attentionScore(
  scores: Record<HfsCategory, number>,
  relevance: number,
  weights: AttentionWeights = DEFAULT_ATTENTION,
): number {
  const raw =
    (weights.signal * scores.signal + weights.facts * scores.facts + weights.hype * scores.hype) /
      100 +
    weights.relevance * relevance;
  const all = Object.values(weights);
  const min = all.filter((w) => w < 0).reduce((a, b) => a + b, 0);
  const max = all.filter((w) => w > 0).reduce((a, b) => a + b, 0);
  return Math.round(((raw - min) / (max - min)) * 100);
}

/** Confidence gate from level10/toolkit.ts. */
export function gate(
  answer: ChoiceAnswer | ScoreAnswer,
  thresholds: { floor?: number; bar?: number } = {},
): "auto" | "confirm" | "human" {
  const floor = thresholds.floor ?? 0.5;
  const bar = thresholds.bar ?? 0.9;
  if (answer.confidence < floor) return "human";
  if (answer.confidence < bar) return "confirm";
  return "auto";
}

/** Probability of yes for a noul answer. */
export function yes(answer: Answer | undefined, id: string): number {
  if (!answer || answer.type !== "noul") throw new Error(`Expected a noul answer for "${id}"`);
  return answer.noul;
}

/** What happens to an item whose text may instruct the agent reading it. */
export type InjectionVerdict = "allow" | "restrict" | "reject";

export interface InjectionPolicy {
  /** At or above this yes-probability the text commands the reader AI: drop the item. */
  reject_min?: number;
  /** At or below this probability the text is ordinary content: the agent may read it in full. */
  allow_max?: number;
}

export const DEFAULT_INJECTION: Required<InjectionPolicy> = {
  reject_min: 0.7,
  allow_max: 0.3,
};

/**
 * Three bands, as the injection-judge article recommends: hard reject at or above reject_min, hard allow at or
 * below allow_max, and everything in between stays under review, so only the title and excerpt reach the agent.
 */
export function injectionVerdict(score: number, policy: InjectionPolicy = {}): InjectionVerdict {
  const rejectMin = policy.reject_min ?? DEFAULT_INJECTION.reject_min;
  const allowMax = policy.allow_max ?? DEFAULT_INJECTION.allow_max;
  if (score >= rejectMin) return "reject";
  if (score <= allowMax) return "allow";
  return "restrict";
}
