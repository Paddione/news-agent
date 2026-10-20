// Picking a sweep's few cards. jev scores how important each gated item is to the reader (topic weight, source
// weight, taste examples), then that score is weighed by the same weights and by freshness, and the top N become the
// sweep's candidates. N is the reader's cards per sweep setting, or the run's own number.
import type { Source } from "@dna/sdk";
import type { Item } from "../db/repos/news.ts";
import type { Store } from "../db/store.ts";
import { watching } from "./sources/discover.ts";

/** The source an item came from, or the source that watches its site. */
export function sourceFor(store: Store, item: Pick<Item, "sourceId" | "url">): Source | undefined {
  const sources = store.sources.list();
  return (
    (item.sourceId && sources.find((s) => s.id === item.sourceId)) || watching(sources, item.url)
  );
}

/** The reader's weights for an item: its topic's (times the topic's group) and its source's, 1 when there is none. */
export function weightsOf(
  store: Store,
  item: Pick<Item, "sourceId" | "url" | "matchedTopic">,
): { topic: number; source: number } {
  const keyword = item.matchedTopic ? store.taste.findKeyword("topic", item.matchedTopic) : undefined;
  const topic = keyword ? store.taste.effectiveWeight(keyword) : 1;
  return { topic, source: sourceFor(store, item)?.weight ?? 1 };
}

/** New beats old: a day old counts in full, then less each day. */
export function freshness(publishedAt: string | undefined, now = Date.now()): number {
  const hours = publishedAt ? (now - Date.parse(publishedAt)) / 3_600_000 : 48;
  return hours <= 24 ? 1 : hours <= 72 ? 0.85 : hours <= 168 ? 0.7 : 0.55;
}

/** jev's importance (0 to 1) weighed by the topic and source weights and by freshness. */
export const rankScore = (
  importance: number,
  weights: { topic: number; source: number },
  publishedAt?: string,
) => importance * weights.topic * weights.source * freshness(publishedAt);
