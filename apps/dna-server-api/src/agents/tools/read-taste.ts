import { Type } from "@earendil-works/pi-ai";
import { defineAppTool, toolText } from "@dna/durable-agent";
import type { Keyword } from "@dna/sdk";
import type { Deps } from "../../deps.ts";
import { sourceLine } from "./reader.ts";

export function readTaste(deps: Deps) {
  return defineAppTool({
    name: "read_taste",
    returns:
      "Text: the reader's keywords and weights by section (topic, signal, facts, hype), their sources with ids and weights, and their recent feedback.",
    description:
      "The reader's taste: topic keywords and section keywords with weights (0.1 to 2.0; a grouped topic also shows its group, the group's weight and the effective weight), sources with ids and weights (0.1 to 2.0), and their recent Show me more, Show me less and Hype, Facts, Signal labels.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
      const { taste } = deps.store;
      const groups = new Map(taste.groups().map((g) => [g.id, g]));
      const weightOf = (k: Keyword) => {
        const g = k.groupId ? groups.get(k.groupId) : undefined;
        return g ? `${k.weight} (${g.name} x${g.weight} = ${taste.effectiveWeight(k)})` : `${k.weight}`;
      };
      const group = (kind: "topic" | "hype" | "facts" | "signal") =>
        `${kind}: ${
          taste
            .keywords(kind, true)
            .slice(0, 12)
            .map((k) => `${k.term} ${weightOf(k)}`)
            .join(", ") || "none"
        }`;
      const recent = deps.store.taste
        .recentFeedback(10)
        .map(
          (f) =>
            `card ${f.cardId} "${f.title}": ${f.signal ? `show me ${f.signal}` : ""}${f.labels.length ? ` labeled ${f.labels.join(" and ")}` : ""}`,
        );
      return toolText(
        [
          group("topic"),
          group("signal"),
          group("facts"),
          group("hype"),
          "",
          "sources:",
          ...deps.store.sources.list().map(sourceLine),
          "",
          "recent feedback:",
          ...(recent.length ? recent : ["none yet"]),
        ].join("\n"),
      );
    },
  });
}
