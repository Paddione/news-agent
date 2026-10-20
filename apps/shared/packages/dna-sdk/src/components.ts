// Generative UI: the components the agent may render, by enum. The server checks rules; clients map each to a view.

export const NEWS_COMPONENTS = [
  "headline",
  "brief",
  "signal_alert",
  "fact_check",
  "hype_watch",
  "release",
  "thread_pulse",
  "quote",
] as const;
export type NewsComponent = (typeof NEWS_COMPONENTS)[number];
/** Every card is a news card; related cards share a timeline instead of a separate story card. */
export type CardComponent = NewsComponent;

export const HFS_CATEGORIES = ["hype", "facts", "signal"] as const;
export type HfsCategory = (typeof HFS_CATEGORIES)[number];

export interface ComponentSpec {
  use: string;
  required: readonly string[];
  rule: string;
}

export const COMPONENT_SPECS: Record<CardComponent, ComponentSpec> = {
  headline: {
    use: "a major item with a strong image",
    required: ["title", "dek"],
    rule: "attention 70 or more",
  },
  brief: {
    use: "the default compact card",
    required: ["title", "summary"],
    rule: "none",
  },
  signal_alert: {
    use: "something to act on now",
    required: ["title", "action", "why"],
    rule: "signal 60 or more",
  },
  fact_check: {
    use: "a claim worth checking",
    required: ["claim", "verdict", "evidence"],
    rule: "an hfs classification exists",
  },
  hype_watch: {
    use: "loud but thin",
    required: ["title", "reality_check"],
    rule: "hype 40 or more",
  },
  release: {
    use: "a version shipped",
    required: ["name", "version", "changes"],
    rule: "none",
  },
  thread_pulse: {
    use: "a discussion matters more than the link",
    required: ["title", "takes"],
    rule: "the item has a discussion link",
  },
  quote: { use: "one striking line", required: ["quote", "speaker"], rule: "none" },
};

/** A number the agent copied from the article. The server keeps only numbers it finds in the source text. */
export interface Figure {
  label: string;
  value: number;
  unit?: string;
  group?: string;
}
export const FIGURES_MAX = 6;
export const FIGURE_LABEL_MAX = 60;

export function figuresOf(props: Record<string, unknown>): Figure[] {
  const raw = props.figures;
  if (!Array.isArray(raw)) return [];
  const out: Figure[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const { label, value, unit, group } = e as Record<string, unknown>;
    if (typeof label !== "string" || !label || typeof value !== "number" || !Number.isFinite(value))
      continue;
    out.push({
      label,
      value,
      ...(typeof unit === "string" && unit ? { unit } : {}),
      ...(typeof group === "string" && group ? { group } : {}),
    });
    if (out.length === FIGURES_MAX) break;
  }
  return out;
}

export function figureGroups(figures: Figure[]): {
  bars: { key: string; unit?: string; rows: Figure[] }[];
  rest: Figure[];
} {
  const byKey = new Map<string, Figure[]>();
  for (const f of figures) {
    const key = `${f.group ?? ""}|${f.unit ?? ""}`;
    byKey.set(key, [...(byKey.get(key) ?? []), f]);
  }
  const bars = [...byKey]
    .filter(([, rows]) => rows.length >= 2)
    .map(([key, rows]) => ({ key, ...(rows[0].unit ? { unit: rows[0].unit } : {}), rows }));
  const inBars = new Set(bars.flatMap((b) => b.rows));
  return { bars, rest: figures.filter((f) => !inBars.has(f)) };
}
