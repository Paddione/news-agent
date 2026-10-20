# P2 — Zahlen aus dem Artikel

Spec: `design.md` §P2, D4, D5, D9. Abhängig von P0 (Task 4 nutzt `BarChart`).

Abweichung vom Spec (F11): In der TUI-Zeile wird nicht mit `……` aufgefüllt, sondern mit Leerzeichen. `render.test.ts` verbietet `…` und `·` in jeder TUI-Ausgabe (`BANNED`).

## Task 1: Server-Check `verifyFigures`

**Files:**
- Modify: `apps/shared/packages/dna-sdk/src/components.ts` (Typ und Konstanten am Dateiende)
- Create: `apps/dna-server-api/src/news/figures.ts`
- Test: `apps/dna-server-api/tests/figures.test.ts`

**Interfaces:**
- Produces (SDK):
  ```ts
  export interface Figure { label: string; value: number; unit?: string; group?: string }
  export const FIGURES_MAX = 6;
  export const FIGURE_LABEL_MAX = 60;
  ```
- Produces (Server, `figures.ts`):
  - `type DropReason = "invalid" | "unsupported" | "no_evidence" | "over_limit"`
  - `interface DroppedFigure { label: string; value: unknown; reason: DropReason }`
  - `spellings(value: number): string[]`
  - `supported(value: number, evidence: string): boolean`
  - `verifyFigures(raw: unknown, evidence: string): { kept: Figure[]; dropped: DroppedFigure[] }`
  - `evidenceText(input: { contentMd?: string; excerpt?: string; findings: { summary: string; claims: string[]; evidence: string[] }[] }): string`
  - `droppedNote(dropped: DroppedFigure[]): string`: `""` oder `" Dropped figures: <label> <value> (<reason>), ..."`

- [ ] **Step 1: SDK-Typen** (Ende von `apps/shared/packages/dna-sdk/src/components.ts`)

```ts
/** A number the agent copied from the article. The server keeps only numbers it finds in the source text. */
export interface Figure {
  label: string;
  value: number;
  unit?: string;
  group?: string;
}
export const FIGURES_MAX = 6;
export const FIGURE_LABEL_MAX = 60;
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/dna-server-api/tests/figures.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { droppedNote, evidenceText, supported, verifyFigures } from "../src/news/figures.ts";

const ARTICLE =
  "Released in 2025, the model scores 72.5% on SWE-bench (up from 61). It costs $3 per 1M tokens, " +
  "serves 1,234 requests a second, has 1.2k stars, 4 billion parameters and 7.3M downloads.";

test("each spelling of a number is found in the article", () => {
  for (const v of [72.5, 61, 3, 1234, 1200, 4e9, 7.3e6]) assert.ok(supported(v, ARTICLE), `${v}`);
  assert.ok(supported(72.5, "scores 72,5 %"), "decimal comma");
  assert.ok(supported(1234, "1.234 requests"), "dot thousands");
  assert.ok(supported(1234, "1 234 requests"), "space thousands");
});

test("a number inside a longer number does not count", () => {
  assert.equal(supported(5, ARTICLE), false, "5 is inside 2025 and 72.5");
  assert.equal(supported(72, ARTICLE), false, "72 is the start of 72.5");
  assert.equal(supported(1, "has 1.2k stars"), false, "1 is the start of 1.2k");
  assert.equal(supported(4, ARTICLE), false, "4 is followed by billion");
  assert.equal(supported(202, ARTICLE), false);
});

test("verifyFigures keeps backed numbers, drops the rest with a reason, and caps at 6", () => {
  const { kept, dropped } = verifyFigures(
    [
      { label: "SWE-bench", value: 72.5, unit: "%", group: "bench" },
      { label: "previous", value: 61, unit: "%", group: "bench" },
      { label: "made up", value: 88 },
      { label: "", value: 3 },
      { label: "not a number", value: "12" },
      { label: "a", value: 3 },
      { label: "b", value: 1234 },
      { label: "c", value: 1200 },
      { label: "d", value: 4e9 },
      { label: "e", value: 7.3e6 },
    ],
    ARTICLE,
  );
  assert.deepEqual(kept.map((f) => f.label), ["SWE-bench", "previous", "a", "b", "c", "d"]);
  assert.deepEqual(
    dropped.map((d) => `${d.label}:${d.reason}`),
    ["made up:unsupported", ":invalid", "not a number:invalid", "e:over_limit"],
  );
  assert.equal(droppedNote(dropped).startsWith(" Dropped figures: made up 88 (unsupported)"), true);
  assert.equal(droppedNote([]), "");
});

test("no evidence drops everything, no figures is a no-op, a non array is invalid", () => {
  assert.deepEqual(verifyFigures([{ label: "x", value: 1 }], "  ").dropped.map((d) => d.reason), ["no_evidence"]);
  assert.deepEqual(verifyFigures(undefined, ARTICLE), { kept: [], dropped: [] });
  assert.deepEqual(verifyFigures("72.5", ARTICLE).dropped.map((d) => d.reason), ["invalid"]);
  assert.equal(verifyFigures([{ label: "x".repeat(61), value: 61 }], ARTICLE).dropped[0].reason, "invalid");
});

test("evidenceText joins cached text, excerpt and findings", () => {
  const text = evidenceText({ contentMd: "a 1", excerpt: "b 2", findings: [{ summary: "c 3", claims: ["d 4"], evidence: ["https://e.dev/5"] }] });
  for (const v of [1, 2, 3, 4]) assert.ok(supported(v, text), `${v}`);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/dna-server-api && npx tsx --test tests/figures.test.ts`
Expected: FAIL with `Cannot find module '../src/news/figures.ts'`

- [ ] **Step 4: Write minimal implementation**

```ts
// apps/dna-server-api/src/news/figures.ts
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
    return new RegExp(String.raw`(?<![\d.,])${esc(s)}${suffixed ? String.raw`(?![a-zA-Z\d])` : AFTER}`).test(evidence);
  });
}

function parse(entry: unknown): Figure | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  const label = typeof e.label === "string" ? e.label.trim() : "";
  if (!label || label.length > FIGURE_LABEL_MAX) return undefined;
  if (typeof e.value !== "number" || !Number.isFinite(e.value)) return undefined;
  const opt = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const unit = opt(e.unit, 12);
  const group = opt(e.group, 40);
  return { label, value: e.value, ...(unit ? { unit } : {}), ...(group ? { group } : {}) };
}

export function verifyFigures(raw: unknown, evidence: string): { kept: Figure[]; dropped: DroppedFigure[] } {
  const kept: Figure[] = [];
  const dropped: DroppedFigure[] = [];
  if (raw === undefined || raw === null) return { kept, dropped };
  if (!Array.isArray(raw)) return { kept, dropped: [{ label: "figures", value: raw, reason: "invalid" }] };
  const hasEvidence = evidence.trim().length > 0;
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const label = typeof e.label === "string" ? e.label.trim() : "";
    const f = parse(entry);
    if (!f) dropped.push({ label, value: e.value, reason: "invalid" });
    else if (!hasEvidence) dropped.push({ label, value: f.value, reason: "no_evidence" });
    else if (!supported(f.value, evidence)) dropped.push({ label, value: f.value, reason: "unsupported" });
    else if (kept.length >= FIGURES_MAX) dropped.push({ label, value: f.value, reason: "over_limit" });
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
```

Zu den Prüffällen. `supported(1, "1.2k")` ist falsch, weil auf die `1` ein `.2` folgt (`[.,]\d`). `supported(4, "4 billion")` ist falsch durch `\s?billion\b`. `supported(1200, "1.2k")` passt über die Schreibweise `1.2k` mit `(?![a-zA-Z\d])`. Beim Wert `1234` erzeugt die Gruppierung mit `.` die Schreibweise `1.234`. Das ist Absicht (Spec), auch wenn es mit der Dezimalzahl `1.234` kollidiert.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/dna-server-api && npx tsx --test tests/figures.test.ts`
Expected: PASS (5 tests). Schlägt ein Fall fehl, die Regex korrigieren, nicht den Test.

- [ ] **Step 6: Commit**

```bash
git add apps/shared/packages/dna-sdk/src/components.ts apps/dna-server-api/src/news/figures.ts apps/dna-server-api/tests/figures.test.ts
git commit -m "feat(figures): verify card numbers against the article text"
```

## Task 2: `present_news` speichert nur belegte Zahlen

**Files:**
- Modify: `apps/dna-server-api/src/agents/tools/present.ts` (`PROPS_HELP` Zeile 15–16, `execute` um `addCard` Zeile 149–177)
- Modify: `apps/dna-server-api/prompt_engineering/agents/news-desk/SYSTEM_PROMPT.md` (nach der `present_news`-Zeile, Zeile 32)
- Test: `apps/dna-server-api/tests/tools.test.ts` (neuer Test am Ende)

**Interfaces:**
- Consumes: `verifyFigures`, `evidenceText`, `droppedNote` (Task 1), `deps.store.sources.cachedById(id)?.contentMd`, `deps.store.news.findings(itemId)`.
- Produces: `card.props.figures` ist entweder nicht vorhanden oder ein `Figure[]` mit 1 bis 6 belegten Einträgen. Die Tool-Antwort endet mit `droppedNote(...)`.

- [ ] **Step 1: Write the failing test**

```ts
test("present_news keeps only figures the article backs and names the dropped ones", async () => {
  const doc = app.store.sources.cache({
    url: "https://bench.example.dev/swe",
    title: "New model tops SWE-bench",
    excerpt: "Scores 72.5% on SWE-bench.",
    contentMd: "The model scores 72.5% on SWE-bench Verified, up from 61% for the previous release in 2025.",
    fetchVia: "feed",
    ttlMinutes: 60,
  });
  const id = app.store.news.upsertItem({ cacheId: doc.id, url: doc.url, title: doc.title!, sourceName: "bench.example.dev", publishedAt: "2026-10-19T10:00:00Z" }).item.id;
  const r = await callTool(app.main, "present_news", {
    item_id: id,
    component: "brief",
    props: {
      title: "New model tops SWE-bench",
      summary: "72.5 percent",
      figures: [
        { label: "New model", value: 72.5, unit: "%", group: "swe" },
        { label: "Previous", value: 61, unit: "%", group: "swe" },
        { label: "Invented", value: 5, unit: "%" },
      ],
    },
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Dropped figures: Invented 5 \(unsupported\)/);
  const card = app.store.news.cardForItem(id)!;
  assert.deepEqual(card.props.figures, [
    { label: "New model", value: 72.5, unit: "%", group: "swe" },
    { label: "Previous", value: 61, unit: "%", group: "swe" },
  ]);
});

test("present_news on an item without any source text drops figures but still presents", async () => {
  const id = app.store.news.upsertItem({ url: "https://bare.example.dev/x", title: "Bare item", sourceName: "bare.example.dev", publishedAt: "2026-10-19T10:00:00Z" }).item.id;
  const r = await callTool(app.main, "present_news", {
    item_id: id,
    component: "brief",
    props: { title: "Bare", summary: "s", figures: [{ label: "x", value: 3 }] },
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /x 3 \(no_evidence\)/);
  assert.equal(app.store.news.cardForItem(id)!.props.figures, undefined);
});
```

`publishedAt` setzen, damit `present_news` keinen Datums-Abruf für die Fixture-Domain braucht (`ItemInput.publishedAt` existiert, `news.ts:61`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dna-server-api && npx tsx --test tests/tools.test.ts`
Expected: FAIL. `r.text` enthält kein `Dropped figures`, und `card.props.figures` enthält noch den erfundenen Eintrag.

- [ ] **Step 3: Write minimal implementation**

In `present.ts`:
```ts
import { droppedNote, evidenceText, verifyFigures } from "../../news/figures.ts";
```
`PROPS_HELP` um diesen Satz ergänzen (an den bestehenden String anhängen):
```ts
  " Optional on every component: figures, an array of at most 6 { label, value, unit?, group? } with value a number copied exactly from the article (benchmark scores, prices, counts). Numbers not found in the article are dropped."
```
In `execute` direkt vor `const imageId = await imageFor(...)`:
```ts
      const cached = item.cacheId ? deps.store.sources.cachedById(item.cacheId) : undefined;
      const figures = verifyFigures(
        args.props.figures,
        evidenceText({ contentMd: cached?.contentMd, excerpt: item.excerpt, findings: deps.store.news.findings(item.id) }),
      );
      const props: Record<string, unknown> = { ...args.props };
      if (figures.kept.length) props.figures = figures.kept;
      else delete props.figures;
      if (figures.dropped.length) deps.log.info("card.figures_dropped", { itemId: item.id, dropped: figures.dropped });
```
In `addCard({...})` `props: args.props` durch `props` ersetzen. Das abschließende `toolText` wird zu:
```ts
      return toolText(
        `Presented card ${card.id} (${card.component}, ${scoreLine(card)}).${droppedNote(figures.dropped)}`,
        { cardId: card.id },
      );
```

In `SYSTEM_PROMPT.md` nach der Zeile `- present_news: render one item as a card. ...` einfügen:
```markdown
- figures: when the article states numbers that matter (benchmark scores, prices, sizes, counts), add up to 6 as props.figures with the exact value from the text. Give entries that compare the same thing the same unit and group. Never round, convert or estimate: a number the article does not contain is dropped.
```

`present.ts` liegt danach bei etwa 285 Zeilen. Das ist vertretbar, kein Split nötig.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dna-server-api && npx tsx --test tests/tools.test.ts tests/sweep-faux.test.ts tests/components.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dna-server-api/src/agents/tools/present.ts apps/dna-server-api/prompt_engineering/agents/news-desk/SYSTEM_PROMPT.md apps/dna-server-api/tests/tools.test.ts
git commit -m "feat(figures): present_news keeps only backed figures and reports the dropped ones"
```

## Task 3: SDK-Helfer für Clients

**Files:**
- Modify: `apps/shared/packages/dna-sdk/src/components.ts`
- Test: `apps/shared/packages/dna-sdk/tests/figures.test.ts`

**Interfaces:**
- Produces:
  - `figuresOf(props: Record<string, unknown>): Figure[]`: liest `props.figures` defensiv. Ungültige Einträge werden übersprungen, höchstens `FIGURES_MAX`.
  - `figureGroups(figures: Figure[]): { bars: { key: string; unit?: string; rows: Figure[] }[]; rest: Figure[] }`: Ein Balkendiagramm entsteht pro `(group ?? "", unit ?? "")` mit mindestens 2 Einträgen, in der Reihenfolge des ersten Auftretens. Alle anderen Einträge landen in `rest`, in Eingabereihenfolge.

- [ ] **Step 1: Write the failing test**

```ts
// apps/shared/packages/dna-sdk/tests/figures.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { figureGroups, figuresOf } from "../src/components.ts";

test("figuresOf reads only valid entries", () => {
  assert.deepEqual(figuresOf({}), []);
  assert.deepEqual(figuresOf({ figures: "x" }), []);
  assert.deepEqual(
    figuresOf({ figures: [{ label: "a", value: 1 }, { label: "b" }, null, { label: "c", value: 2, unit: "%" }] }),
    [{ label: "a", value: 1 }, { label: "c", value: 2, unit: "%" }],
  );
});

test("figureGroups makes a bar group per group and unit with 2 or more rows", () => {
  const f = [
    { label: "new", value: 72.5, unit: "%", group: "swe" },
    { label: "price", value: 3, unit: "$" },
    { label: "old", value: 61, unit: "%", group: "swe" },
    { label: "stars", value: 1200 },
  ];
  const g = figureGroups(f);
  assert.deepEqual(g.bars.map((b) => [b.key, b.unit, b.rows.map((r) => r.label)]), [["swe|%", "%", ["new", "old"]]]);
  assert.deepEqual(g.rest.map((r) => r.label), ["price", "stars"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/shared/packages/dna-sdk && npx tsx --test tests/figures.test.ts`
Expected: FAIL with `figureGroups is not a function` bzw. dem fehlenden Export

- [ ] **Step 3: Write minimal implementation** (am Ende von `components.ts`)

```ts
export function figuresOf(props: Record<string, unknown>): Figure[] {
  const raw = props.figures;
  if (!Array.isArray(raw)) return [];
  const out: Figure[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const { label, value, unit, group } = e as Record<string, unknown>;
    if (typeof label !== "string" || !label || typeof value !== "number" || !Number.isFinite(value)) continue;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/shared/packages/dna-sdk && npx tsx --test tests/figures.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/shared/packages/dna-sdk/src/components.ts apps/shared/packages/dna-sdk/tests/figures.test.ts
git commit -m "feat(sdk): add figuresOf and figureGroups for card clients"
```

## Task 4: TUI-Zeilen

**Files:**
- Modify: `apps/dna-client-tui/src/cards.ts` (`cardBody`, neue Funktion `figureLines`)
- Test: `apps/dna-client-tui/tests/render.test.ts`

**Interfaces:**
- Consumes: `figuresOf`, `figureGroups` (Task 3).
- Produces: `figureLines(props: Record<string, unknown>): string[]`. Jede Zeile hat die Form `  <label auf Breite aufgefüllt>  <value>[ unit][  ▇▇▇]`. Die Balkenlänge ist `round(value / max * 20)` und mindestens 1, max ist das Maximum der Gruppe. Bei Werten außerhalb einer Gruppe gibt es keinen Balken. Ohne Zahlen ist das Ergebnis `[]`.

- [ ] **Step 1: Write the failing test** (am Ende von `render.test.ts`, `figureLines` zum Import aus `../src/cards.ts` hinzufügen)

```ts
test("figures render as aligned lines with bars for a group and no banned punctuation", () => {
  const lines = figureLines({
    figures: [
      { label: "New model", value: 72.5, unit: "%", group: "swe" },
      { label: "Previous", value: 61, unit: "%", group: "swe" },
      { label: "Price", value: 3, unit: "$" },
    ],
  }).map(stripTerminalSequences);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^ {2}New model {2,}72\.5 % {2}▇{20}$/);
  assert.match(lines[1], /^ {2}Previous {2,}61 % {2}▇{17}$/);
  assert.match(lines[2], /^ {2}Price {2,}3 \$$/);
  assert.equal(lines[0].indexOf("72.5"), lines[1].indexOf("61"), "values align");
  clean(lines, "figure lines");
  assert.deepEqual(figureLines({}), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dna-client-tui && npx tsx --test tests/render.test.ts`
Expected: FAIL with `figureLines` nicht exportiert (SyntaxError beim Import)

- [ ] **Step 3: Write minimal implementation**

```ts
import { ago, cleanText, figureGroups, figuresOf, type Card, type HfsCategory, type HfsScores } from "@dna/sdk";
```
```ts
/** Numbers from the article: label, value and unit aligned; a bar for each value in a compared group. */
export function figureLines(props: Record<string, unknown>): string[] {
  const figures = figuresOf(props);
  if (!figures.length) return [];
  const { bars } = figureGroups(figures);
  const barOf = new Map<unknown, number>();
  for (const g of bars) {
    const max = Math.max(...g.rows.map((r) => r.value));
    for (const r of g.rows) barOf.set(r, max > 0 ? Math.max(1, Math.round((r.value / max) * 20)) : 1);
  }
  const width = Math.max(...figures.map((f) => cleanText(f.label).length));
  return figures.map((f) => {
    const value = `${f.value}${f.unit ? ` ${f.unit}` : ""}`;
    const bar = barOf.has(f) ? `  ${c.accent("▇".repeat(barOf.get(f)!))}` : "";
    return `  ${cleanText(f.label).padEnd(width)}  ${c.bold(value)}${bar}`;
  });
}
```
In `cardBody` das Ergebnis des `switch` in einer Variablen sammeln und die Zahlen anhängen. Am wenigsten Eingriff erfordert es, die Funktion umzubenennen:
```ts
export function cardBody(card: Card): string[] {
  return [...componentBody(card), ...figureLines(card.props)];
}
```
Dazu wird die bisherige `cardBody` zu `function componentBody(card: Card): string[]`, mit unverändertem Rumpf.

Achtung: Der Test erwartet nach dem Label mindestens zwei Leerzeichen und keine Füllpunkte (F11).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dna-client-tui && npx tsx --test tests/render.test.ts`
Expected: PASS (alle bestehenden Tests plus der neue)

- [ ] **Step 5: Commit**

```bash
git add apps/dna-client-tui/src/cards.ts apps/dna-client-tui/tests/render.test.ts
git commit -m "feat(tui): show card figures as aligned lines with bars"
```

## Task 5: Browser — kompakte Zeile auf der Karte, Balken im Dialog

**Files:**
- Create: `apps/dna-client-browser/fe/src/components/cards/FiguresBlock.vue`
- Modify: `apps/dna-client-browser/fe/src/components/cards/CardView.vue` (in `.card-main` nach `<component :is="body" .../>`)
- Modify: `apps/dna-client-browser/fe/src/components/CardDetailDialog.vue` (nach `<HfsPill :hfs="detail.card.hfs" />`)
- Modify: `apps/dna-client-browser/fe/src/styles/app.css` (Block `.figures-*` am Ende)
- Test: `apps/dna-client-browser/tests/ui-faux.mjs` (neuer Check-Block vor `console.log("ALL PASS")`)

**Interfaces:**
- Consumes: `figuresOf`, `figureGroups` (Task 3), `BarChart` (P0).
- Produces: `FiguresBlock` mit Props `{ cardProps: Record<string, unknown>; compact?: boolean }`.
  - Mit `compact` entsteht `<div class="figures-compact">` mit den ersten 3 Werten als `<span class="figure-chip"><b>value unit</b> label</span>`.
  - Ohne `compact` entsteht `<section class="figures-full">` mit einem `BarChart` pro Gruppe und einer `<table class="figures-table">` für `rest`.
  - Ohne Zahlen wird nichts gerendert.

- [ ] **Step 1: Write the failing UI check** (in `ui-faux.mjs` vor `console.log("ALL PASS")`. Das bestehende `fixtureDb` (Zeile 113) und das vorhandene `page`-Objekt nutzen und deren Namen aus der Datei übernehmen.)

```js
// Figures: give the first news card two backed numbers, reload, and check the compact row and the dialog bars.
{
  const figCard = fixtureDb.prepare("SELECT id FROM cards WHERE kind = 'news' ORDER BY id LIMIT 1").get().id;
  fixtureDb
    .prepare("UPDATE cards SET props_json = json_set(props_json, '$.figures', json(?)) WHERE id = ?")
    .run(JSON.stringify([
      { label: "New model", value: 72.5, unit: "%", group: "swe" },
      { label: "Previous", value: 61, unit: "%", group: "swe" },
    ]), figCard);
  await page.reload();
  const row = page.locator(`[data-card-id="${figCard}"] .figures-compact .figure-chip`);
  await row.first().waitFor();
  check((await row.count()) === 2, "figures render compact on the card");
  await page.locator(`[data-card-id="${figCard}"] button[aria-label="Card details"]`).click();
  await page.locator(".card-detail .figures-full svg.viz-bar").waitFor();
  check(true, "figures render compact on the card and as bars in the detail dialog");
  await page.keyboard.press("Escape");
  await page.locator(".card-detail button[aria-label='Close']").click().catch(() => {});
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build -w dna-client-browser && node apps/dna-client-browser/tests/ui-faux.mjs`
Expected: FAIL. Timeout beim Warten auf `.figures-compact .figure-chip`.

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- apps/dna-client-browser/fe/src/components/cards/FiguresBlock.vue -->
<script setup lang="ts">
// Numbers from the article. compact: up to 3 chips on the fixed-height card. Full: bars per compared group, a table
// for the rest (card detail dialog).
import { computed } from "vue";
import { figureGroups, figuresOf } from "@dna/sdk";
import { fmt } from "../viz/scale";
import BarChart from "../viz/BarChart.vue";

const props = defineProps<{ cardProps: Record<string, unknown>; compact?: boolean }>();
const figures = computed(() => figuresOf(props.cardProps));
const groups = computed(() => figureGroups(figures.value));
const show = (v: number, unit?: string) => `${fmt(v)}${unit ? ` ${unit}` : ""}`;
</script>

<template>
  <div v-if="figures.length && compact" class="figures-compact">
    <span v-for="f in figures.slice(0, 3)" :key="f.label" class="figure-chip"
      ><b>{{ show(f.value, f.unit) }}</b> {{ f.label }}</span
    >
  </div>
  <section v-else-if="figures.length" class="figures-full" aria-label="Numbers from the article">
    <BarChart v-for="g in groups.bars" :key="g.key" :rows="g.rows" :unit="g.unit" />
    <table v-if="groups.rest.length" class="figures-table">
      <tr v-for="f in groups.rest" :key="f.label">
        <th>{{ f.label }}</th>
        <td>{{ show(f.value, f.unit) }}</td>
      </tr>
    </table>
  </section>
</template>
```

`CardView.vue`: Import `import FiguresBlock from "./FiguresBlock.vue";`, im Template nach `<component :is="body" :card="card" />`:
```vue
        <FiguresBlock :card-props="card.props" compact />
```
`CardDetailDialog.vue`: Import `import FiguresBlock from "./cards/FiguresBlock.vue";`, nach `<HfsPill :hfs="detail.card.hfs" />`:
```vue
        <FiguresBlock :card-props="detail.card.props" />
```
CSS am Ende von `app.css`:
```css
.figures-compact { display: flex; flex-wrap: wrap; gap: 6px; }
.figure-chip { font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.figure-chip b { color: var(--text); font-variant-numeric: tabular-nums; }
.figures-full { display: grid; gap: 10px; margin: 10px 0; }
.figures-table th { text-align: left; font-weight: 400; color: var(--muted); padding-right: 12px; }
.figures-table td { font-variant-numeric: tabular-nums; }
```
Prüfen, ob `Card.props` in `@dna/sdk` als `Record<string, unknown>` typisiert ist (`grep -n "props" apps/shared/packages/dna-sdk/src/api.ts`). Ist der Typ enger, beim Aufruf passend casten.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run check -w dna-client-browser && npm run build -w dna-client-browser && node apps/dna-client-browser/tests/ui-faux.mjs`
Expected: `PASS figures render compact on the card`, `PASS figures render compact on the card and as bars in the detail dialog`, `ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add apps/dna-client-browser/fe/src/components/cards/FiguresBlock.vue apps/dna-client-browser/fe/src/components/cards/CardView.vue apps/dna-client-browser/fe/src/components/CardDetailDialog.vue apps/dna-client-browser/fe/src/styles/app.css apps/dna-client-browser/tests/ui-faux.mjs
git commit -m "feat(browser): show card figures as chips on the card and bars in the detail dialog"
```
