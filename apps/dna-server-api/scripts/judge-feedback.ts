// apps/dna-server-api/scripts/judge-feedback.ts
// Reader feedback as judge training rows. A card's Hype/Facts/Signal labels answer the hfs call that scored its item;
// Show me more / less answers worth-attention's `worth` question. Each row carries the exact prompt the judge saw
// (from JEV_CAPTURE) and `human.allowed`, the label indices the reader's answer permits. Training keeps the teacher's
// distribution inside that set (news-judge-train corpus.apply_human), so `judge-corpus label` runs on these rows as is.
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { exportCorpus, type CorpusRow } from "./judge-corpus.ts";

export interface FeedbackEntry {
  cardId: number;
  itemId: number | null;
  signal: "more" | "less" | null;
  labels: string[] | null;
  createdAt: string;
}

export interface HumanRow extends CorpusRow {
  human: { allowed: number[]; card_id: number; at: string; source: "feedback" };
}

// hfs labels a category when its normalized score reaches policy.label_threshold (50): index 2 of 0..3 is 67.
const HFS_HIGH = [2, 3];
const HFS_LOW = [0, 1];

interface Capture {
  line: string;
  command: string;
  item_id: number | null;
  at?: string;
}

/** The judge call the reader saw: the latest capture of that command and item at or before the feedback. */
function seen(
  captures: Capture[],
  command: string,
  itemId: number,
  at: string,
): string | undefined {
  let pick: Capture | undefined;
  for (const c of captures) {
    if (c.command !== command || c.item_id !== itemId) continue;
    if (c.at && c.at > at) continue;
    if (!pick || !pick.at || (c.at && c.at >= pick.at)) pick = c;
  }
  return pick?.line;
}

export function feedbackRows(feedback: FeedbackEntry[], captureLines: string[]): HumanRow[] {
  const captures: Capture[] = captureLines
    .filter((l) => l.trim())
    .map((line) => {
      const rec = JSON.parse(line);
      return { line, command: rec.command, item_id: rec.item_id ?? null, at: rec.at };
    });
  // The feedback table appends: the reader's last word per card and kind is the answer.
  const latest = new Map<string, FeedbackEntry>();
  for (const f of [...feedback].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (f.labels) latest.set(`${f.cardId}:labels`, f);
    if (f.signal) latest.set(`${f.cardId}:signal`, f);
  }
  const rows: HumanRow[] = [];
  for (const [key, f] of latest) {
    if (f.itemId === null) continue;
    const human = (allowed: number[]) =>
      ({ allowed, card_id: f.cardId, at: f.createdAt, source: "feedback" }) as const;
    if (key.endsWith(":labels")) {
      const line = seen(captures, "hfs", f.itemId, f.createdAt);
      if (!line) continue;
      for (const row of exportCorpus([line]))
        rows.push({
          ...row,
          human: human(f.labels!.includes(row.question_id) ? HFS_HIGH : HFS_LOW),
        });
    } else {
      const line = seen(captures, "worth-attention", f.itemId, f.createdAt);
      if (!line) continue;
      for (const row of exportCorpus([line]))
        if (row.question_id === "worth")
          rows.push({ ...row, human: human(f.signal === "more" ? [0] : [1]) });
    }
  }
  return rows;
}

export function readFeedback(dbPath: string): FeedbackEntry[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT f.card_id, c.item_id, f.signal, f.labels_json, f.created_at FROM feedback f JOIN cards c ON c.id = f.card_id ORDER BY f.id",
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      cardId: Number(r.card_id),
      itemId: r.item_id === null ? null : Number(r.item_id),
      signal: (r.signal as FeedbackEntry["signal"]) ?? null,
      labels: r.labels_json ? (JSON.parse(String(r.labels_json)) as string[]) : null,
      createdAt: String(r.created_at),
    }));
  } finally {
    db.close();
  }
}

function main() {
  const { positionals } = parseArgs({ allowPositionals: true });
  const [cmd, dbPath, capture, output] = positionals;
  if (cmd !== "export" || !dbPath || !capture || !output) {
    console.error("usage: judge-feedback.ts export <dna.sqlite> <capture.jsonl> <feedback.jsonl>");
    process.exit(2);
  }
  const feedback = readFeedback(dbPath);
  const rows = feedbackRows(feedback, readFileSync(capture, "utf8").split("\n"));
  writeFileSync(output, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  console.log(`${feedback.length} feedback entries -> ${rows.length} rows in ${output}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
