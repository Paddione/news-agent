// Keywords per section, topic groups, feedback on cards, and the taste questions the agent asks.
import type { HfsCategory, Keyword, TasteQuestion, TopicGroup } from "@dna/sdk";
import { bind, bool, type Db, nowIso, num, parse, str } from "../db.ts";

export type KeywordKind = Keyword["kind"];

/** Group names are kebab-case, like agent-harnesses. */
export const GROUP_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const toKeyword = (r: any): Keyword => ({
  id: r.id,
  kind: r.kind,
  term: r.term,
  weight: r.weight,
  source: r.source,
  enabled: bool(r.enabled),
  lastSearchedAt: str(r.last_searched_at),
  groupId: num(r.group_id),
});

const toGroup = (r: any): TopicGroup => ({
  id: r.id,
  name: r.name,
  weight: r.weight,
  enabled: bool(r.enabled),
  topicCount: r.topic_count ?? 0,
});

const GROUP_SQL = `SELECT g.*, (SELECT count(*) FROM keywords k WHERE k.group_id = g.id) AS topic_count
  FROM topic_groups g`;

const toQuestion = (r: any): TasteQuestion => ({
  id: r.id,
  cardId: num(r.card_id),
  itemId: num(r.item_id),
  question: r.question,
  status: r.status,
  answerLabels: parse(r.answer_labels_json, []),
  createdAt: r.created_at,
  answeredAt: str(r.answered_at),
});

export class TasteRepo {
  constructor(private readonly db: Db) {}

  seed(groups: Record<KeywordKind, string[]>): number {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO keywords (kind, term, source, created_at, updated_at) VALUES (?, ?, 'seed', ?, ?)",
    );
    let added = 0;
    const now = nowIso();
    for (const [kind, terms] of Object.entries(groups))
      for (const term of terms) added += Number(insert.run(kind, term, now, now).changes);
    return added;
  }

  keywords(kind?: KeywordKind, enabledOnly = false): Keyword[] {
    const where = [kind ? "kind = :kind" : "", enabledOnly ? "enabled = 1" : ""]
      .filter(Boolean)
      .join(" AND ");
    return (
      this.db
        .prepare(
          `SELECT * FROM keywords ${where ? `WHERE ${where}` : ""} ORDER BY kind, weight DESC, term`,
        )
        .all(bind({ ...(kind ? { kind } : {}) })) as any[]
    ).map(toKeyword);
  }

  keyword(id: number): Keyword | undefined {
    const r = this.db.prepare("SELECT * FROM keywords WHERE id = ?").get(id);
    return r ? toKeyword(r) : undefined;
  }

  findKeyword(kind: KeywordKind, term: string): Keyword | undefined {
    const r = this.db
      .prepare("SELECT * FROM keywords WHERE kind = ? AND lower(term) = lower(?)")
      .get(kind, term);
    return r ? toKeyword(r) : undefined;
  }

  addKeyword(kind: KeywordKind, term: string, weight = 1): Keyword {
    const now = nowIso();
    this.db
      .prepare(
        "INSERT INTO keywords (kind, term, weight, source, created_at, updated_at) VALUES (?, ?, ?, 'user', ?, ?) ON CONFLICT (kind, term) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at",
      )
      .run(kind, term.trim(), weight, now, now);
    return this.findKeyword(kind, term.trim())!;
  }

  updateKeyword(
    id: number,
    patch: { weight?: number; enabled?: boolean; term?: string },
  ): Keyword | undefined {
    const k = this.keyword(id);
    if (!k) return undefined;
    this.db
      .prepare(
        "UPDATE keywords SET weight = :weight, enabled = :enabled, term = :term, updated_at = :now WHERE id = :id",
      )
      .run(
        bind({
          id,
          weight: clamp(patch.weight ?? k.weight),
          enabled: patch.enabled ?? k.enabled,
          term: patch.term?.trim() || k.term,
          now: nowIso(),
        }),
      );
    return this.keyword(id);
  }

  removeKeyword(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM keywords WHERE id = ?").run(id).changes) > 0;
  }

  /** Add delta to a weight, clamped to 0.1..2.0. */
  nudge(id: number, delta: number): Keyword | undefined {
    const k = this.keyword(id);
    if (!k) return undefined;
    return this.updateKeyword(id, { weight: Math.round((k.weight + delta) * 100) / 100 });
  }

  // Topic groups

  groups(): TopicGroup[] {
    return (this.db.prepare(`${GROUP_SQL} ORDER BY g.weight DESC, g.name`).all() as any[]).map(
      toGroup,
    );
  }

  group(id: number): TopicGroup | undefined {
    const r = this.db.prepare(`${GROUP_SQL} WHERE g.id = ?`).get(id);
    return r ? toGroup(r) : undefined;
  }

  findGroup(name: string): TopicGroup | undefined {
    const r = this.db.prepare(`${GROUP_SQL} WHERE g.name = ?`).get(name.trim());
    return r ? toGroup(r) : undefined;
  }

  addGroup(name: string, weight = 1, enabled = true): TopicGroup {
    const n = groupName(name);
    if (this.findGroup(n)) throw new Error(`A group "${n}" already exists`);
    const now = nowIso();
    const r = this.db
      .prepare(
        "INSERT INTO topic_groups (name, weight, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(n, clamp(weight), enabled ? 1 : 0, now, now);
    return this.group(Number(r.lastInsertRowid))!;
  }

  updateGroup(
    id: number,
    patch: { name?: string; weight?: number; enabled?: boolean },
  ): TopicGroup | undefined {
    const g = this.group(id);
    if (!g) return undefined;
    const name = patch.name === undefined ? g.name : groupName(patch.name);
    const other = this.findGroup(name);
    if (other && other.id !== id) throw new Error(`A group "${name}" already exists`);
    this.db
      .prepare(
        "UPDATE topic_groups SET name = :name, weight = :weight, enabled = :enabled, updated_at = :now WHERE id = :id",
      )
      .run(
        bind({
          id,
          name,
          weight: clamp(patch.weight ?? g.weight),
          enabled: patch.enabled ?? g.enabled,
          now: nowIso(),
        }),
      );
    return this.group(id);
  }

  /** Remove a group; its topics stay, without a group. */
  removeGroup(id: number): boolean {
    this.db.prepare("UPDATE keywords SET group_id = NULL WHERE group_id = ?").run(id);
    return Number(this.db.prepare("DELETE FROM topic_groups WHERE id = ?").run(id).changes) > 0;
  }

  /** Put a topic in a group, or take it out with null. Hype, facts and signal keywords have no group. */
  setKeywordGroup(keywordId: number, groupId: number | null): Keyword | undefined {
    const k = this.keyword(keywordId);
    if (!k) return undefined;
    if (groupId !== null && k.kind !== "topic")
      throw new Error(`Only topics take a group, not ${k.kind} keywords`);
    this.db
      .prepare("UPDATE keywords SET group_id = ?, updated_at = ? WHERE id = ?")
      .run(groupId, nowIso(), keywordId);
    return this.keyword(keywordId);
  }

  /** A topic's weight times its group's (1 without a group). */
  effectiveWeight(k: Keyword): number {
    const g = k.groupId ? this.group(k.groupId) : undefined;
    return Math.round(k.weight * (g?.weight ?? 1) * 100) / 100;
  }

  /** Enabled topics outside disabled groups: the ones sweeps search and jev may match. */
  activeTopics(): Keyword[] {
    return (
      this.db
        .prepare(
          `SELECT k.* FROM keywords k LEFT JOIN topic_groups g ON g.id = k.group_id
           WHERE k.kind = 'topic' AND k.enabled = 1 AND coalesce(g.enabled, 1) = 1
           ORDER BY k.weight DESC, k.term`,
        )
        .all() as any[]
    ).map(toKeyword);
  }

  markSearched(ids: number[]): void {
    const now = nowIso();
    const stmt = this.db.prepare("UPDATE keywords SET last_searched_at = ? WHERE id = ?");
    for (const id of ids) stmt.run(now, id);
  }

  addFeedback(
    cardId: number,
    input: { signal?: "more" | "less"; labels?: HfsCategory[]; note?: string },
  ): void {
    this.db
      .prepare(
        "INSERT INTO feedback (card_id, signal, labels_json, note, created_at) VALUES (:card_id, :signal, :labels, :note, :now)",
      )
      .run(
        bind({
          card_id: cardId,
          signal: input.signal,
          labels: input.labels,
          note: input.note,
          now: nowIso(),
        }),
      );
  }

  /** Recent feedback joined to card titles, newest first. */
  recentFeedback(limit = 20): {
    cardId: number;
    title: string;
    signal?: "more" | "less";
    labels: HfsCategory[];
    at: string;
  }[] {
    return (
      this.db
        .prepare(
          `SELECT f.card_id, f.signal, f.labels_json, f.created_at, COALESCE(json_extract(c.props_json, '$.title'), i.title, '') AS title
           FROM feedback f JOIN cards c ON c.id = f.card_id LEFT JOIN items i ON i.id = c.item_id
           ORDER BY f.id DESC LIMIT ?`,
        )
        .all(limit) as any[]
    ).map((r) => ({
      cardId: r.card_id,
      title: r.title,
      signal: r.signal ?? undefined,
      labels: parse(r.labels_json, []),
      at: r.created_at,
    }));
  }

  // Taste questions

  askQuestion(input: {
    cardId?: number;
    itemId?: number;
    question: string;
    toolCallId: string;
    conversationId?: number;
  }): { question: TasteQuestion; created: boolean } {
    const existing = this.db
      .prepare("SELECT * FROM taste_questions WHERE tool_call_id = ?")
      .get(input.toolCallId);
    if (existing) return { question: toQuestion(existing), created: false };
    const open = input.itemId
      ? this.db
          .prepare("SELECT * FROM taste_questions WHERE item_id = ? AND status = 'open'")
          .get(input.itemId)
      : undefined;
    if (open) return { question: toQuestion(open), created: false };
    const r = this.db
      .prepare(
        "INSERT INTO taste_questions (card_id, item_id, question, tool_call_id, conversation_id, created_at) VALUES (:card_id, :item_id, :question, :tool_call_id, :conversation_id, :now)",
      )
      .run(
        bind({
          card_id: input.cardId,
          item_id: input.itemId,
          question: input.question,
          tool_call_id: input.toolCallId,
          conversation_id: input.conversationId,
          now: nowIso(),
        }),
      );
    return { question: this.question(Number(r.lastInsertRowid))!, created: true };
  }

  question(id: number): TasteQuestion | undefined {
    const r = this.db.prepare("SELECT * FROM taste_questions WHERE id = ?").get(id);
    return r ? toQuestion(r) : undefined;
  }

  questions(status?: TasteQuestion["status"]): TasteQuestion[] {
    const sql = status
      ? "SELECT * FROM taste_questions WHERE status = ? ORDER BY id"
      : "SELECT * FROM taste_questions ORDER BY id";
    return (status ? this.db.prepare(sql).all(status) : this.db.prepare(sql).all()).map(toQuestion);
  }

  answer(id: number, labels: HfsCategory[]): TasteQuestion | undefined {
    this.db
      .prepare(
        "UPDATE taste_questions SET status = 'answered', answer_labels_json = ?, answered_at = ? WHERE id = ? AND status = 'open'",
      )
      .run(JSON.stringify(labels), nowIso(), id);
    return this.question(id);
  }
}

export const clamp = (weight: number) => Math.min(2, Math.max(0.1, weight));

function groupName(name: string): string {
  const n = name.trim();
  if (!GROUP_NAME.test(n) || n.length > 40)
    throw new Error(`Group names are kebab-case, 1 to 40 characters: "${n}"`);
  return n;
}
