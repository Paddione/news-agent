export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

export interface InvestigationReport {
  summary: string;
  source: { claim: string; evidence: string[] }[];
  existing: { project: string; paths: string[]; note: string }[];
  missing: string[];
  proposal: "adopt" | "evaluate" | "watch" | "drop";
  targets: string[];
  reasoning: string;
}

const PROPOSAL_DE: Record<InvestigationReport["proposal"], string> = {
  adopt: "übernehmen",
  evaluate: "bewerten",
  watch: "beobachten",
  drop: "verwerfen",
};

export function parseReport(text: string, allowed: string[]): InvestigationReport {
  let raw = text.trim();
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(raw);
  if (fenceMatch) raw = fenceMatch[1].trim();

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      } catch (err2: any) {
        throw new ReportError(`Invalid JSON in investigation report: ${err2.message}`);
      }
    } else {
      throw new ReportError(`Invalid JSON in investigation report: ${err.message}`);
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ReportError("Report must be a JSON object");
  }

  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
    throw new ReportError("Report must have a non-empty summary string");
  }

  if (!Array.isArray(parsed.source)) {
    throw new ReportError("Report must have a source array");
  }
  for (const s of parsed.source) {
    if (!s || typeof s.claim !== "string" || !Array.isArray(s.evidence)) {
      throw new ReportError("Each source entry must have claim (string) and evidence (string[])");
    }
  }

  if (!Array.isArray(parsed.existing)) {
    throw new ReportError("Report must have an existing array");
  }
  for (const e of parsed.existing) {
    if (
      !e ||
      typeof e.project !== "string" ||
      !Array.isArray(e.paths) ||
      typeof e.note !== "string"
    ) {
      throw new ReportError(
        "Each existing entry must have project (string), paths (string[]), note (string)",
      );
    }
  }

  if (!Array.isArray(parsed.missing) || parsed.missing.some((m: any) => typeof m !== "string")) {
    throw new ReportError("Report must have a missing string[] array");
  }

  const validProposals = ["adopt", "evaluate", "watch", "drop"] as const;
  if (!validProposals.includes(parsed.proposal)) {
    throw new ReportError(
      `Proposal must be one of: ${validProposals.join(", ")}, got "${parsed.proposal}"`,
    );
  }

  if (!Array.isArray(parsed.targets)) {
    throw new ReportError("Report must have a targets array");
  }
  const targets = parsed.targets.filter((t: any) => typeof t === "string" && allowed.includes(t));

  if (typeof parsed.reasoning !== "string" || !parsed.reasoning.trim()) {
    throw new ReportError("Report must have a non-empty reasoning string");
  }

  return {
    summary: parsed.summary.trim(),
    source: parsed.source,
    existing: parsed.existing,
    missing: parsed.missing,
    proposal: parsed.proposal,
    targets,
    reasoning: parsed.reasoning.trim(),
  };
}

export function renderReport(
  r: InvestigationReport,
  meta: {
    route: string;
    model: string;
    date: string;
    automaticRepoSearch?: boolean;
  },
): string {
  const sourceText = r.source.length
    ? r.source
        .map((s) => `- **${s.claim}**\n${s.evidence.map((e) => `  - ${e}`).join("\n")}`)
        .join("\n")
    : "Keine Quellenangaben.";

  const existingItems = r.existing.length
    ? r.existing
        .map(
          (e) => `- **${e.project}:** ${e.note}\n${e.paths.map((p) => `  - \`${p}\``).join("\n")}`,
        )
        .join("\n")
    : "Keine passenden Bestandteile gefunden.";

  const existingText = meta.automaticRepoSearch
    ? `*(automatische Suche, kein Abgleich durch das Modell)*\n\n${existingItems}`
    : existingItems;

  const missingText = r.missing.length
    ? r.missing.map((m) => `- ${m}`).join("\n")
    : "Keine fehlenden Punkte identifiziert.";

  const targetsText = r.targets.length ? r.targets.join(", ") : "keine";

  return [
    "## Kurzfazit",
    "",
    r.summary,
    "",
    "## Was die Quelle sagt",
    "",
    sourceText,
    "",
    "## Was wir schon haben",
    "",
    existingText,
    "",
    "## Was fehlt",
    "",
    missingText,
    "",
    "## Vorschlag",
    "",
    `- **Empfehlung:** ${PROPOSAL_DE[r.proposal]}`,
    `- **Ziel-Repos:** ${targetsText}`,
    `- **Begründung:** ${r.reasoning}`,
    "",
    "---",
    `*Untersuchung via ${meta.route} (${meta.model}) am ${meta.date}.*`,
  ].join("\n");
}

export function targetLabels(targets: string[]): string[] {
  return targets.map((t) => {
    if (t === "home-patrick") return "target:dotfiles";
    if (t.startsWith("home-patrick-")) return `target:${t.slice("home-patrick-".length)}`;
    return `target:${t}`;
  });
}

export function repairPrompt(error: string): string {
  return `The previous investigation report response was invalid: ${error}.
Please return ONLY a valid JSON object matching the InvestigationReport schema without extra conversational text.`;
}
