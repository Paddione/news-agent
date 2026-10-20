// Numbers the agent puts on a card must appear in the article: every spelling of a value (1,234 / 1.234 / 1 234,
// 72.5 / 72,5, 1.2k, 3M, 4 billion) is searched with number boundaries, so 5 never matches inside 2025.
import { FIGURE_LABEL_MAX, FIGURES_MAX, type Figure } from "@dna/sdk";

export type DropReason = "invalid" | "unsupported" | "no_evidence" | "over_limit";
export interface DroppedFigure {
  label: string;
  value: unknown;
  reason: DropReason;
}

const SCALES: [number, string[], string][] = [
  [1e3, ["k", "K"], "thousand"],
  [1e6, ["M", "m"], "million"],
  [1e9, ["B", "bn"], "billion"],
];

export function spellings(value: number): string[] {
  const out = new Set<string>();
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const [int, frac] = String(abs).split(".");
  for (const sep of ["", ",", ".", " "]) {
    const grouped = sep ? int.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : int;
    if (frac === undefined) out.add(sign + grouped);
    else for (const dec of [".", ","]) if (dec !== sep) out.add(`${sign}${grouped}${dec}${frac}`);
  }
  for (const [n, short, long] of SCALES) {
    if (abs < n) continue;
    const scaled = Number((abs / n).toFixed(2));
    if (Math.abs(scaled * n - abs) > abs * 1e-9) continue;
    const s = String(scaled);
    for (const x of short) out.add(`${sign}${s}${x}`);
    out.add(`${sign}${s} ${long}`);
  }
  return [...out];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const AFTER = String.raw`(?!\d|[.,]\d|\s?(?:k|K|M|m|B|bn|thousand|million|billion)\b)`;

export function supported(value: number, evidence: string): boolean {
  return spellings(value).some((s) => {
    const suffixed = /[a-zA-Z]$/.test(s);
    return new RegExp(
      String.raw`(?<![\d.,])${esc(s)}${suffixed ? String.raw`(?![a-zA-Z\d])` : AFTER}`,
    ).test(evidence);
  });
}

function parse(entry: unknown): Figure | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  const label = typeof e.label === "string" ? e.label.trim() : "";
  if (!label || label.length > FIGURE_LABEL_MAX) return undefined;
  if (typeof e.value !== "number" || !Number.isFinite(e.value)) return undefined;
  const opt = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  const unit = opt(e.unit, 12);
  const group = opt(e.group, 40);
  return { label, value: e.value, ...(unit ? { unit } : {}), ...(group ? { group } : {}) };
}

export function verifyFigures(
  raw: unknown,
  evidence: string,
): { kept: Figure[]; dropped: DroppedFigure[] } {
  const kept: Figure[] = [];
  const dropped: DroppedFigure[] = [];
  if (raw === undefined || raw === null) return { kept, dropped };
  if (!Array.isArray(raw))
    return { kept, dropped: [{ label: "figures", value: raw, reason: "invalid" }] };
  const hasEvidence = evidence.trim().length > 0;
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const label = typeof e.label === "string" ? e.label.trim() : "";
    const f = parse(entry);
    if (!f) dropped.push({ label, value: e.value, reason: "invalid" });
    else if (!hasEvidence) dropped.push({ label, value: f.value, reason: "no_evidence" });
    else if (!supported(f.value, evidence))
      dropped.push({ label, value: f.value, reason: "unsupported" });
    else if (kept.length >= FIGURES_MAX)
      dropped.push({ label, value: f.value, reason: "over_limit" });
    else kept.push(f);
  }
  return { kept, dropped };
}

export function evidenceText(input: {
  contentMd?: string;
  excerpt?: string;
  findings: { summary: string; claims: string[]; evidence: string[] }[];
}): string {
  return [
    input.contentMd ?? "",
    input.excerpt ?? "",
    ...input.findings.flatMap((f) => [f.summary, ...f.claims, ...f.evidence]),
  ].join("\n");
}

export function droppedNote(dropped: DroppedFigure[]): string {
  if (!dropped.length) return "";
  return ` Dropped figures: ${dropped.map((d) => `${d.label} ${String(d.value)} (${d.reason})`).join(", ")}. Only use numbers that appear in the article.`;
}
