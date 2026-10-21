import { Type } from "@earendil-works/pi-ai";
import { defineAppTool, toolError, toolText } from "@dna/durable-agent";
import type { Deps } from "../../deps.ts";
import { agentText } from "../../news/injection.ts";
import { clip, FixableError, requireItem } from "./shared.ts";

export function readItem(deps: Deps) {
  return defineAppTool({
    name: "read_item",
    returns:
      "Text: the item's title, source, dates, jev scores and findings, then its cached text clipped to max_chars.",
    description:
      "Read one item: title, source, url, dates, discussion, and its cached text (capped). Also shows findings and jev scores so far.",
    parameters: Type.Object({
      item_id: Type.Integer(),
      max_chars: Type.Optional(Type.Integer({ minimum: 200, maximum: 6000 })),
    }),
    replay: "safe",
    outputLimits: { maxBytes: 16_000 },
    execute: async (args) => {
      try {
        const item = requireItem(deps, args.item_id);
        const cached = item.cacheId
          ? deps.store.sources.cachedById(item.cacheId)
          : deps.store.sources.cached(item.url);
        const page =
          cached?.contentMd && cached.contentMd.length > (item.excerpt?.length ?? 0)
            ? cached.contentMd
            : item.excerpt;
        // An item the judge could not clear gets the feed's words only: the page is where a payload hides.
        const visible = agentText(item, page);
        const hfs = deps.store.news.latestHfs(item.id);
        const findings = deps.store.news.findings(item.id);
        const lines = [
          `#${item.id} ${item.title}`,
          `source: ${item.sourceName ?? "unknown"} | url: ${item.url}${item.discussionUrl ? ` | discussion: ${item.discussionUrl}` : ""}`,
          `published: ${item.publishedAt ?? "unknown"} | status: ${item.status} | relevance ${Math.round((item.relevance ?? 0) * 100)} | worth ${Math.round((item.worth ?? 0) * 100)}${item.injection === undefined ? "" : ` | injection ${Math.round(item.injection * 100)}`}`,
          hfs
            ? `jev hfs: ${hfs.ranked.map((r) => `${r.category} ${r.score}`).join(", ")}${hfs.suspectCombo ? " (suspect_combo)" : ""}`
            : "jev hfs: not classified yet",
          ...findings.map(
            (f) => `finding: ${f.summary} (actionability ${f.actionability ?? "unknown"})`,
          ),
          "",
          visible.restricted
            ? `${visible.reason}. Use the title and the excerpt above, and tell the reader the page is withheld.`
            : clip(visible.text, args.max_chars ?? 3000) ||
              "No cached text. Use scrape_url to fetch the page.",
        ];
        return toolText(lines.join("\n"));
      } catch (error) {
        if (error instanceof FixableError) return toolError(error.message, error.hints);
        throw error;
      }
    },
  });
}
