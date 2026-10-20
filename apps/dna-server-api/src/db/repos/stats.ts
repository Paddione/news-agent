// Dashboard aggregates over a window of whole UTC days: topics by day, the sweep funnel, H/F/S by day and source,
// and how often the judge's primary category is among the reader's labels.
import type { DatabaseSync } from "node:sqlite";
import type { FunnelCounts, HfsName, Stats } from "@dna/sdk";

const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

export function windowStart(days: number, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString();
}

const LATEST_HFS = `
  SELECT c.*, COALESCE(i.source_name, '(unknown)') AS source
    FROM classifications c LEFT JOIN items i ON i.id = c.item_id
   WHERE c.command = 'hfs' AND c.created_at >= :from
     AND c.id = (SELECT MAX(c2.id) FROM classifications c2 WHERE c2.item_id = c.item_id AND c2.command = 'hfs')`;

export class StatsRepo {
  constructor(private readonly db: DatabaseSync) {}

  stats(days: number, now = new Date()): Stats {
    const from = windowStart(days, now);
    const all = <T>(sql: string) => this.db.prepare(sql).all({ from }) as unknown as T[];

    const topics = all<{
      topic: string;
      day: string;
      count: number;
      avgAttention: number | null;
    }>(
      `SELECT COALESCE(matched_topic, '(none)') AS topic, substr(created_at, 1, 10) AS day,
              COUNT(*) AS count, AVG(attention) AS avgAttention
         FROM items WHERE created_at >= :from GROUP BY 1, 2 ORDER BY 1, 2`,
    ).map((t) => ({ ...t, avgAttention: r1(t.avgAttention) }));

    const sweeps = all<{ id: number; startedAt: string } & FunnelCounts>(
      `SELECT id, COALESCE(started_at, created_at) AS startedAt,
              COALESCE(gathered, 0) AS gathered, COALESCE(kept, 0) AS kept, COALESCE(duplicates, 0) AS duplicates,
              COALESCE(candidates, 0) AS candidates, COALESCE(presented, 0) AS presented
         FROM sweeps WHERE created_at >= :from ORDER BY id`,
    );
    const total: FunnelCounts = {
      gathered: 0,
      kept: 0,
      duplicates: 0,
      candidates: 0,
      presented: 0,
    };
    for (const s of sweeps)
      for (const k of Object.keys(total) as (keyof FunnelCounts)[]) total[k] += s[k];

    const avgBy = (key: string) =>
      all<{ k: string; hype: number; facts: number; signal: number; n: number }>(
        `SELECT ${key} AS k, AVG(hype) AS hype, AVG(facts) AS facts, AVG(signal) AS signal, COUNT(*) AS n
           FROM (${LATEST_HFS}) GROUP BY 1 ORDER BY 1`,
      ).map(({ k, ...v }) => ({
        k,
        hype: r1(v.hype)!,
        facts: r1(v.facts)!,
        signal: r1(v.signal)!,
        n: v.n,
      }));
    const byDay = avgBy("substr(created_at, 1, 10)").map(({ k, ...v }) => ({ day: k, ...v }));
    const bySource = avgBy("source").map(({ k, ...v }) => ({ source: k, ...v }));
    const primary = all<{ category: HfsName; count: number }>(
      `SELECT primary_category AS category, COUNT(*) AS count FROM (${LATEST_HFS}) GROUP BY 1 ORDER BY 1`,
    );

    const fbDay = all<{ day: string; more: number; less: number }>(
      `SELECT substr(created_at, 1, 10) AS day, SUM(signal = 'more') AS more, SUM(signal = 'less') AS less
         FROM feedback WHERE created_at >= :from AND signal IN ('more', 'less') GROUP BY 1 ORDER BY 1`,
    ).map((d) => ({ day: d.day, more: d.more, less: d.less }));
    const labelled = all<{ judge: HfsName; labels: string }>(
      `SELECT c.primary_category AS judge, f.labels_json AS labels
         FROM feedback f JOIN cards c ON c.id = f.card_id
        WHERE f.created_at >= :from AND c.primary_category IS NOT NULL
          AND f.labels_json IS NOT NULL AND json_array_length(f.labels_json) > 0
          AND f.id = (SELECT MAX(f2.id) FROM feedback f2 WHERE f2.card_id = f.card_id
                        AND f2.labels_json IS NOT NULL AND json_array_length(f2.labels_json) > 0)`,
    );
    const judges = new Map<HfsName, Stats["feedback"]["byJudge"][number]>();
    for (const { judge, labels } of labelled) {
      const set = new Set(JSON.parse(labels) as string[]);
      const row = judges.get(judge) ?? {
        judge,
        n: 0,
        humanHype: 0,
        humanFacts: 0,
        humanSignal: 0,
        hits: 0,
      };
      row.n++;
      if (set.has("hype")) row.humanHype++;
      if (set.has("facts")) row.humanFacts++;
      if (set.has("signal")) row.humanSignal++;
      if (set.has(judge)) row.hits++;
      judges.set(judge, row);
    }
    const byJudge = [...judges.values()].sort((a, b) => a.judge.localeCompare(b.judge));
    const n = byJudge.reduce((s, j) => s + j.n, 0);
    const hits = byJudge.reduce((s, j) => s + j.hits, 0);

    return {
      window: { from, to: now.toISOString(), days },
      topics,
      funnel: { total, sweeps },
      hfs: { byDay, bySource, primary },
      feedback: {
        byDay: fbDay,
        byJudge,
        agreement: n ? Math.round((hits / n) * 100) / 100 : null,
      },
    };
  }
}
