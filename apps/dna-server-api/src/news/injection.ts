// What an agent tool may show of an item whose injection score is still under review.
//
// The sweep gate drops items at or above `reject_min`; the uncertain band between the two thresholds stays in
// the feed, so the tools that hand page text to the agent model must withhold it there. Judge-side reads
// (page text for hfs, story matching, rescore) deliberately ignore this: the judge is what does the checking.
import {
  DEFAULT_INJECTION,
  injectionVerdict,
  type InjectionPolicy,
  type InjectionVerdict,
} from "@dna/jev";
import type { Item } from "../db/repos/news.ts";

export const injectionPolicy = (policy: InjectionPolicy = {}): InjectionPolicy => ({
  reject_min: policy.reject_min ?? DEFAULT_INJECTION.reject_min,
  allow_max: policy.allow_max ?? DEFAULT_INJECTION.allow_max,
});

/** The verdict behind an item's stored score; undefined until the judge scored it. */
export function storedVerdict(
  item: Pick<Item, "injection">,
  policy?: InjectionPolicy,
): InjectionVerdict | undefined {
  return item.injection === undefined
    ? undefined
    : injectionVerdict(item.injection, injectionPolicy(policy));
}

/** Why the agent must not see the page text of this item, or undefined when it may. */
export function withheldReason(
  item: Pick<Item, "title" | "excerpt" | "injection">,
  policy?: InjectionPolicy,
): string | undefined {
  const verdict = storedVerdict(item, policy);
  if (verdict === undefined || verdict === "allow") return undefined;
  const score = item.injection!.toFixed(2);
  const band = verdict === "reject" ? "at or above the reject threshold" : "in the review band";
  return `prompt-injection score ${score} ${band}: only the title and the feed excerpt are shown`;
}

export interface VisibleText {
  /** What the agent may read: the page text for an ordinary item, title and excerpt while under review. */
  text?: string;
  /** True when the full text was withheld; `reason` says why. */
  restricted: boolean;
  reason?: string;
}

/**
 * Page text for an agent tool, restricted to title and excerpt while the item's injection score sits in the
 * review band (or withheld entirely for an item that was rejected but is still read somehow).
 */
export function agentText(
  item: Pick<Item, "title" | "excerpt" | "injection">,
  full?: string,
  policy?: InjectionPolicy,
): VisibleText {
  const reason = withheldReason(item, policy);
  if (reason) return { text: item.excerpt ?? item.title, restricted: true, reason };
  return { text: full ?? item.excerpt, restricted: false };
}
