// Coach digest: weekly summary over taste data (keywords, feedback, open
// questions). renderDigest is pure; assembleDigest reads a DigestStore and
// writes the outbox file once per week. Tested without a server boot.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface DigestKeyword {
  term: string;
  kind: string;
  weight: number;
}

export interface DigestFeedback {
  title: string;
  signal?: "more" | "less";
  labels: string[];
  at: string;
}

export interface DigestQuestion {
  id: number;
  question: string;
  status: string;
  cardId?: number;
}

export interface DigestInput {
  keywords: DigestKeyword[];
  feedback: DigestFeedback[];
  questions: DigestQuestion[];
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();

export function digestFilename(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}-digest.md`;
}

/** True when filename is not in the outbox index (dedup: never present twice). */
export function isNewDigest(index: string[], filename: string): boolean {
  return !index.includes(filename);
}

export interface DigestStore {
  keywords(): DigestKeyword[];
  recentFeedback(limit: number): DigestFeedback[];
  openQuestions(): DigestQuestion[];
}

export interface AssembleResult {
  status: "completed" | "not_due";
  filename: string;
  bytes: number;
  topics: number;
  feedback: number;
  questions: number;
}

/**
 * Render the weekly digest from the store and write it to the outbox once.
 * Returns not_due when this week's file already exists (no rewrite).
 */
export function assembleDigest(
  store: DigestStore,
  outboxDir: string,
  date = new Date(),
): AssembleResult {
  const filename = digestFilename(date);
  let existing: string[] = [];
  try {
    existing = readdirSync(outboxDir);
  } catch {
    existing = [];
  }
  if (!isNewDigest(existing, filename)) {
    return { status: "not_due", filename, bytes: 0, topics: 0, feedback: 0, questions: 0 };
  }
  const keywords = store.keywords();
  const feedback = store.recentFeedback(20);
  const questions = store.openQuestions();
  const topics = keywords.filter((k) => k.kind === "topic").length;
  const body = renderDigest({ keywords, feedback, questions }, date);
  const bytes = Buffer.byteLength(body, "utf8");
  mkdirSync(outboxDir, { recursive: true });
  writeFileSync(join(outboxDir, filename), body);
  return {
    status: "completed",
    filename,
    bytes,
    topics,
    feedback: feedback.length,
    questions: questions.length,
  };
}

export function renderDigest(input: DigestInput, date = new Date()): string {
  const topics = [...input.keywords]
    .filter((k) => k.kind === "topic")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10);
  const open = input.questions.filter((q) => q.status === "open").slice(0, 20);
  const recent = input.feedback.slice(0, 20);
  const lines = [
    `# Coach digest ${digestFilename(date).replace("-digest.md", "")}`,
    "",
    `Topics: ${topics.length}, recent feedback: ${recent.length}, open questions: ${open.length}.`,
    "",
    "## Top topics",
    "",
    "| term | weight |",
    "| --- | --- |",
    ...topics.map((k) => `| ${cell(k.term)} | ${k.weight.toFixed(2)} |`),
    "",
    "## Recent feedback",
    "",
    ...recent.map(
      (f) =>
        `- ${f.signal === "more" ? "+1" : f.signal === "less" ? "-1" : "·"} ${cell(f.title)}${f.labels.length ? ` [${f.labels.join(", ")}]` : ""}`,
    ),
    "",
    "## Open taste questions",
    "",
    ...open.map((q) => `- #${q.id}: ${cell(q.question)}${q.cardId ? ` (card ${q.cardId})` : ""}`),
    "",
  ];
  return lines.join("\n");
}
