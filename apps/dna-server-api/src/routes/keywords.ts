// Keywords per section (topic, hype, facts, signal) with weights.
import type { Keyword } from "@dna/sdk";
import { int, invalid, notFound } from "../errors.ts";
import { clamp } from "../db/repos/taste.ts";
import { tasteFrame } from "../news/taste.ts";
import { bodyOf, bool, num, oneOf, str, type Handlers, type RouteDeps } from "./types.ts";

const KINDS = ["topic", "hype", "facts", "signal"] as const;

export function keywordRoutes({
  app,
}: RouteDeps): Handlers<"keywords.list" | "keywords.add" | "keywords.update" | "keywords.remove"> {
  const { store } = app;
  /** body.groupId: absent (no change), null (no group) or a group id; only topics take one. */
  const groupOf = (body: Record<string, unknown>, kind: Keyword["kind"]) => {
    const value = body.groupId;
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (kind !== "topic") throw invalid(`Only topics take a group, not ${kind} keywords`);
    const id = int(value, "groupId");
    if (!store.taste.group(id)) throw notFound(`No topic group ${id}`);
    return id;
  };
  return {
    "keywords.list": (req, res) =>
      res.json(
        store.taste.keywords(
          oneOf(req.query.kind, "kind", KINDS, true) as Keyword["kind"] | undefined,
        ),
      ),
    "keywords.add": (req, res) => {
      const body = bodyOf(req);
      const kind = oneOf(body.kind, "kind", KINDS)!;
      const term = str(body, "term", { max: 80 });
      if (store.taste.findKeyword(kind, term)) throw invalid(`${kind} already has "${term}"`);
      const groupId = groupOf(body, kind);
      const added = store.taste.addKeyword(
        kind,
        term,
        clamp(num(body, "weight", { min: 0.1, max: 2 }) ?? 1),
      );
      const keyword = groupId ? store.taste.setKeywordGroup(added.id, groupId)! : added;
      app.log.info("taste.keyword_added", { id: keyword.id, kind, term });
      if (groupId) app.bus.publish(tasteFrame(store));
      res.status(201).json(keyword);
    },
    "keywords.update": (req, res) => {
      const body = bodyOf(req);
      const id = int(req.params.id, "id");
      const current = store.taste.keyword(id);
      if (!current) throw notFound(`No keyword ${req.params.id}`);
      const groupId = groupOf(body, current.kind);
      let keyword = store.taste.updateKeyword(id, {
        weight: num(body, "weight", { min: 0.1, max: 2 }),
        enabled: bool(body, "enabled"),
        term: str(body, "term", { max: 80, optional: true }),
      })!;
      if (groupId !== undefined) {
        keyword = store.taste.setKeywordGroup(id, groupId)!;
        app.bus.publish(tasteFrame(store));
      }
      res.json(keyword);
    },
    "keywords.remove": (req, res) => {
      if (!store.taste.removeKeyword(int(req.params.id, "id")))
        throw notFound(`No keyword ${req.params.id}`);
      res.json({ ok: true });
    },
  };
}
