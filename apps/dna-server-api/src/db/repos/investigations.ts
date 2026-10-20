import type { Investigation, InvestigationStatus } from "@dna/sdk";
import { type Db, bind, nowIso, num, parse, str } from "../db.ts";

export interface InvestigationRow extends Investigation {
  repo: string;
  number: number;
  cardId?: number;
  attempts: number;
  reportMd?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

const toRow = (r: any): InvestigationRow | undefined => {
  if (!r) return undefined;
  return {
    repo: r.repo,
    number: r.number,
    cardId: num(r.card_id),
    status: r.status as InvestigationStatus,
    attempts: r.attempts,
    route: (r.route as "local" | "fallback") ?? undefined,
    model: str(r.model),
    reportMd: str(r.report_md),
    targets: parse<string[]>(r.targets_json, []),
    commentUrl: str(r.comment_url),
    error: str(r.error),
    startedAt: str(r.started_at),
    finishedAt: str(r.finished_at),
    createdAt: r.created_at,
  };
};

export class InvestigationsRepo {
  constructor(private readonly db: Db) {}

  get(repo: string, number: number): InvestigationRow | undefined {
    const r = this.db
      .prepare("SELECT * FROM investigations WHERE repo = ? AND number = ?")
      .get(repo, number);
    return toRow(r);
  }

  forCard(cardId: number): InvestigationRow | undefined {
    const r = this.db
      .prepare(
        `SELECT inv.* FROM investigations inv
         LEFT JOIN card_issues ci ON ci.repo = inv.repo AND ci.number = inv.number
         WHERE inv.card_id = ? OR ci.card_id = ?
         LIMIT 1`,
      )
      .get(cardId, cardId);
    return toRow(r);
  }

  enqueue(
    repo: string,
    number: number,
    cardId?: number,
  ): { row: InvestigationRow; created: boolean } {
    const existing = this.get(repo, number);
    if (existing) {
      if (cardId && !existing.cardId) {
        this.db
          .prepare("UPDATE investigations SET card_id = ? WHERE repo = ? AND number = ?")
          .run(cardId, repo, number);
        return { row: this.get(repo, number)!, created: false };
      }
      return { row: existing, created: false };
    }
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO investigations (repo, number, card_id, status, attempts, created_at)
         VALUES (:repo, :number, :card_id, 'queued', 0, :now)`,
      )
      .run(bind({ repo, number, card_id: cardId, now }));
    return { row: this.get(repo, number)!, created: true };
  }

  running(): InvestigationRow | undefined {
    const r = this.db
      .prepare("SELECT * FROM investigations WHERE status = 'running' LIMIT 1")
      .get();
    return toRow(r);
  }

  start(
    repo: string,
    number: number,
    route: "local" | "fallback",
    model: string,
  ): InvestigationRow {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE investigations
         SET status = 'running', route = :route, model = :model, started_at = :now, attempts = attempts + 1
         WHERE repo = :repo AND number = :number`,
      )
      .run(bind({ repo, number, route, model, now }));
    return this.get(repo, number)!;
  }

  finish(
    repo: string,
    number: number,
    r: { reportMd: string; targets: string[]; commentUrl: string },
  ): InvestigationRow {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE investigations
         SET status = 'done', report_md = :reportMd, targets_json = :targets, comment_url = :commentUrl, finished_at = :now
         WHERE repo = :repo AND number = :number`,
      )
      .run(
        bind({
          repo,
          number,
          reportMd: r.reportMd,
          targets: r.targets,
          commentUrl: r.commentUrl,
          now,
        }),
      );
    return this.get(repo, number)!;
  }

  fail(
    repo: string,
    number: number,
    error: string,
    maxAttempts = 3,
  ): InvestigationRow {
    const current = this.get(repo, number);
    const attempts = current ? current.attempts : 1;
    const nextStatus: InvestigationStatus =
      attempts >= maxAttempts ? "failed" : "queued";
    this.db
      .prepare(
        `UPDATE investigations
         SET status = :status, error = :error
         WHERE repo = :repo AND number = :number`,
      )
      .run(bind({ repo, number, status: nextStatus, error }));
    return this.get(repo, number)!;
  }

  retry(repo: string, number: number): InvestigationRow {
    this.db
      .prepare(
        `UPDATE investigations
         SET status = 'queued', attempts = 0, error = NULL
         WHERE repo = :repo AND number = :number`,
      )
      .run(bind({ repo, number }));
    return this.get(repo, number)!;
  }

  fallbacksToday(day: string): number {
    const r = this.db
      .prepare(
        `SELECT count(*) AS n FROM investigations
         WHERE route = 'fallback' AND started_at LIKE ?`,
      )
      .get(`${day}%`) as { n: number } | undefined;
    return r?.n ?? 0;
  }
}
