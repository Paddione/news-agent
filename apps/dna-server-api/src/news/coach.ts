// Coach digest: pure weekly summary over taste data (keywords, feedback,
// open questions). No store/DB/file access here: callers pass plain data and
// write the returned markdown to coach/outbox/. Tested without a server boot.
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
