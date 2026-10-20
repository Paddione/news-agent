// Taste: feedback moves keyword weights; recent feedback becomes jev few-shot examples; heavy, stale topics get searched.
import type { Card, Frame, HfsCategory, Keyword, SourceLead } from "@dna/sdk";
import type { Store } from "../db/store.ts";
import { leadsFromUpvote } from "./leads.ts";
import { sourceFor } from "./rank.ts";

export const MORE = 0.1;
export const LESS = -0.15;
export const LABEL = 0.1;

/** The live frame for settings: every keyword and every topic group. */
export const tasteFrame = (store: Store): Frame => ({
  type: "taste.keywords",
  keywords: store.taste.keywords(),
  groups: store.taste.groups(),
});

export interface FeedbackResult {
  changed: { id: number; term: string; kind: string; from: number; to: number }[];
  leads: SourceLead[];
}

const mentions = (text: string, term: string) => text.toLowerCase().includes(term.toLowerCase());

export function applyFeedback(
  store: Store,
  card: Card,
  input: { signal?: "more" | "less"; labels?: HfsCategory[] },
): FeedbackResult {
  store.taste.addFeedback(card.id, input);
  const changed: FeedbackResult["changed"] = [];
  const nudge = (k: Keyword, delta: number) => {
    const after = store.taste.nudge(k.id, delta);
    if (after && after.weight !== k.weight)
      changed.push({ id: k.id, term: k.term, kind: k.kind, from: k.weight, to: after.weight });
  };
  const item = card.itemId ? store.news.item(card.itemId) : undefined;
  const text = `${card.title} ${item?.title ?? ""} ${item?.excerpt ?? ""} ${JSON.stringify(card.props)}`;
  if (input.signal) {
    const topics = store.taste.keywords("topic", true);
    const matched = item?.matchedTopic
      ? topics.find((k) => k.term.toLowerCase() === item.matchedTopic!.toLowerCase())
      : undefined;
    const hits = matched ? [matched] : topics.filter((k) => mentions(text, k.term));
    for (const k of hits) nudge(k, input.signal === "more" ? MORE : LESS);
    // The card's source learns too: sweeps rank by source weight as well as topic weight.
    const source = sourceFor(store, { sourceId: item?.sourceId, url: item?.url ?? card.url ?? "" });
    if (source) {
      const to =
        Math.round(
          Math.min(2, Math.max(0.1, source.weight + (input.signal === "more" ? MORE : LESS))) * 100,
        ) / 100;
      if (to !== source.weight) {
        store.sources.update(source.id, { weight: to });
        changed.push({ id: source.id, term: source.name, kind: "source", from: source.weight, to });
      }
    }
  }
  if (input.labels) {
    const jevLabels = card.hfs?.labels ?? [];
    for (const category of ["hype", "facts", "signal"] as HfsCategory[]) {
      const said = input.labels.includes(category);
      const jevSaid = jevLabels.includes(category);
      if (said === jevSaid && !said) continue;
      for (const k of store.taste.keywords(category, true).filter((k) => mentions(text, k.term)))
        nudge(k, said ? LABEL : -LABEL);
    }
  }
  return { changed, leads: leadsFromUpvote(store, card, input) };
}

export interface TasteExample {
  title: string;
  reader: "more" | "less" | "labeled";
  labels: HfsCategory[];
}

export function tasteExamples(store: Store, limit = 6): TasteExample[] {
  const seen = new Set<number>();
  const out: TasteExample[] = [];
  for (const f of store.taste.recentFeedback(40)) {
    if (seen.has(f.cardId) || !f.title) continue;
    seen.add(f.cardId);
    out.push({ title: f.title, reader: f.signal ?? "labeled", labels: f.labels });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A bag of topics for one sweep: a weighted draw without replacement, so a topic's chance follows its effective weight
 * (its own times its group's) and every active topic can come up. `exclude` keeps the terms of an earlier bag out (a second bag is a fresh shuffle).
 */
export function planQueries(
  store: Store,
  count = 15,
  options: { exclude?: string[]; random?: () => number } = {},
): Keyword[] {
  const random = options.random ?? Math.random;
  const skip = new Set((options.exclude ?? []).map((t) => t.toLowerCase()));
  const bag = store.taste
    .activeTopics()
    .filter((k) => !skip.has(k.term.toLowerCase()))
    .map((k) => ({
      k,
      key: Math.pow(random(), 1 / Math.max(store.taste.effectiveWeight(k), 0.01)),
    }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((x) => x.k);
  store.taste.markSearched(bag.map((k) => k.id));
  return bag;
}

export const slug = (term: string) =>
  term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60) || "topic";

/** Choice criteria for jev's matched_topic question: slug to term, plus an exit. */
export function topicChoices(keywords: Keyword[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keywords.slice(0, 250)) {
    let key = slug(k.term);
    for (let i = 2; key in out; i++) key = `${slug(k.term)}_${i}`;
    out[key] = k.term;
  }
  out.none = "None of these topics";
  return out;
}

export function sectionKeywords(store: Store): Record<HfsCategory, string[]> {
  const terms = (kind: HfsCategory) => store.taste.keywords(kind, true).map((k) => k.term);
  return { hype: terms("hype"), facts: terms("facts"), signal: terms("signal") };
}
