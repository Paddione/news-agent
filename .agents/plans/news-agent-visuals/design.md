---
slug: news-agent-visuals
path: feature
status: spec-review
date: 2026-10-20
repo: Paddione/news-agent
main_branch: main
tickets: none
---

# Visuelle Inhalte im News-Agent

## Ziel

Der Feed und die Betriebsansicht werden visuell aussagekräftiger, ohne zusätzliche GPU-Last oder externe Bezahl-APIs. Drei Teile:

1. Jede Karte hat wieder ein Bild (Regression seit der Umstellung auf lokale Modelle beheben).
2. Karten zeigen belegte Zahlen aus dem Artikel als Diagramm.
3. Ein Dashboard zeigt Themenlage, Filtertrichter, H/F/S-Verteilung und Richter-Feedback.

## Ausgangslage (Befunde vom 2026-10-20, live/dna.sqlite)

- F1: Bild-Pipeline in `apps/dna-server-api/src/news/images.ts`: Quell-`og:image`, sonst OpenAI `gpt-image`.
- F2: 46 Quellbilder `ready`, 17 generierte Bilder `failed` mit `OPENAI_API_KEY is not set`.
- F3: 198 von 1209 Items liefern ein `image_url`.
- F5: Die GPU ist durch Swift auf :1919 zu 14,9/15,9 GB belegt. Ein lokales Bildmodell passt nicht parallel dazu.
- `cards.props_json` ist ein freies Record. `source_cache.content_md` hält den Artikeltext. `sweeps` hält die Trichterzahlen (`gathered, kept, duplicates, candidates, presented`).

## Entscheidungen

- D1: Ein Spec, drei Partials mit disjunkten Zieldateien plus ein geteiltes Viz-Partial.
- D2: Karten ohne Quellbild bekommen ein deterministisch gerendertes Bild, ohne Bildmodell. Neue Abhängigkeit ist nur `@resvg/resvg-js`.
- D3: Der OpenAI-Pfad bleibt erhalten. Ist ein Key gesetzt, wird generiert statt gerendert.
- D4: Zahlen liefert der Agent als optionale Prop `figures` in `present_news`. Der Server verwirft jede Zahl, die nicht im Belegtext steht. Die Karte erscheint trotzdem.
- D5: Geprüft wird nur, ob die Zahl belegt ist. Ob Label und Zahl zusammenpassen, wird nicht geprüft.
- D6: Diagramme entstehen als eigene Inline-SVG-Vue-Komponenten, ohne Chart-Bibliothek.
- D7: Das Dashboard gibt es nur im Browser und es wird beim Öffnen geladen. Live-Updates, CLI/TUI-Ansicht und Export gehören nicht dazu.
- D8: Keine Migration. `images.origin` hat `CHECK (origin IN ('source','generated'))`. Gerenderte Bilder werden als `origin='generated'`, `model='card-render@1'` gespeichert. `CardImage` in der SDK bleibt unverändert.
- D9: Karten haben eine feste Höhe von 232 px mit `overflow: hidden`. Die Karte zeigt deshalb höchstens 3 Zahlen als kompakte Zeile, Diagramme und die volle Liste stehen in `CardDetailDialog`.
- D10: Ein Klick auf eine Heatmap-Zelle öffnet den vorhandenen Keyword-Tab (`searchFor(topic)`) nur mit dem Thema. Die Suche kennt keinen Tagesfilter.

## P0 — Geteilte Viz-Komponenten

Ziel: `apps/dna-client-browser/fe/src/components/viz/` mit den folgenden Komponenten.

- `BarChart.vue`: horizontale Balken. Props `rows: {label, value}[]`, `unit?`. Werte und Labels stehen direkt am Balken, es gibt keine Legende.
- `Heatmap.vue`: Props `rows: string[]`, `cols: string[]`, `cells: {row, col, value, title?}[]`. Gibt `select(row, col)` aus.
- `Funnel.vue`: Props `stages: {label, value}[]`, gibt den Anteil zur Vorstufe aus.
- `StackedLine.vue`: Props `x: string[]`, `series: {name, values}[]`.
- `Sparkline.vue`: Props `values: number[]`.
- Alle Farben kommen aus den vorhandenen CSS-Variablen des Themes (H/F/S-Farben wie in `HfsPill.vue`), hell und dunkel. Jede Komponente bekommt `role="img"` und ein `aria-label` mit Klartext-Zusammenfassung.

## P1 — Kartenbild ohne Modell

Zieldateien: `apps/dna-server-api/src/news/images.ts`, neu `src/news/card-render.ts`, neu `src/news/source-images.ts`, `apps/dna-server-api/scripts/backfill-rendered-images.ts`, neu `apps/dna-server-api/assets/fonts/Inter-*.ttf` (OFL), `package.json` von dna-server-api.

Reihenfolge in `Images.resolve`:
1. `item.imageUrl` bzw. `source_cache.image_url` (`og:image`), Prüfung wie bisher über `sourceImage`.
2. YouTube-Thumbnail: Video-ID aus `youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, dann `https://i.ytimg.com/vi/<id>/hqdefault.jpg`.
3. GitHub-Social-Preview für `github.com/<owner>/<repo>[/...]`: `https://opengraph.githubassets.com/1/<owner>/<repo>`.
4. Erstes Markdown-Bild aus `source_cache.content_md`, wenn es den `sourceImage`-Check besteht. Die URL darf nicht `logo`, `icon`, `avatar`, `pixel` oder `1x1` enthalten.

Greift keine Stufe:
- Mit `OPENAI_API_KEY` läuft der bisherige Pfad `pending` → `dna.image`.
- Ohne Key wird synchron gerendert: `origin: "generated"` (D8), `status: "ready"`, `data/images/<imageId>.png`, `cost_usd: 0`, `model: "card-render@1"`.

Rendering (`card-render.ts`):
- `renderCardSvg({title, source, topic, category}) → string` ist eine reine Funktion. `rasterize(svg) → Buffer` läuft über resvg.
- Format 1536×1024. Der Titel wird auf höchstens 4 Zeilen umbrochen, danach folgt eine Ellipse. Quelle und Thema stehen in der Fußzeile. Akzentfarbe nach `primary_category`: hype, facts, signal, ohne Klassifikation neutral. Die Schrift ist das gebündelte Inter (OFL) aus `assets/fonts/`, das resvg ohne Systemschriften lädt. Damit ist das PNG auf WSL und macOS gleich.
- Gleiche Eingabe ergibt dasselbe SVG byte-identisch.

Backfill: `apps/dna-server-api/scripts/backfill-rendered-images.ts --db <pfad> [--dry-run]` rendert alle Bilder mit `origin='generated' AND status='failed'` neu, setzt `status='ready'`, `model='card-render@1'`, `file_path` und publiziert `feed.card_updated` nicht, weil es offline läuft.

Akzeptanz:
- Ohne `OPENAI_API_KEY` entstehen keine `failed`-Bilder mehr.
- `images.test.ts` deckt jede Quellstufe, die Ausschlussliste, Rendern ohne Key, Generieren mit Key und die Determinismus-Prüfung (zweimal gleiche Eingabe ergibt identisches SVG, PNG-Signatur und 1536×1024 im IHDR) ab.

## P2 — Zahlen aus dem Artikel

Zieldateien: `apps/shared/packages/dna-sdk/src/components.ts`, neu `apps/dna-server-api/src/news/figures.ts`, `src/agents/tools/present.ts`, `prompt_engineering/agents/news-desk/` (Prompt), `apps/dna-client-browser/fe/src/components/cards/FiguresBlock.vue`, `cards/CardView.vue`, `apps/dna-client-tui/src/cards.ts`.

Vertrag (`dna-sdk`):
```ts
export interface Figure { label: string; value: number; unit?: string; group?: string }
export const FIGURES_MAX = 6;
export const FIGURE_LABEL_MAX = 60;
```
- `figures` ist eine optionale Prop jeder Komponente und taucht nicht in `required` auf.
- `PROPS_HELP` und der news-desk-Prompt bekommen einen Satz plus ein Beispiel. Danach nennt der Agent nur Zahlen, die wörtlich im Artikel stehen.

Server-Check (`figures.ts`):
- `verifyFigures(raw: unknown, evidence: string) → { kept: Figure[]; dropped: {label, value, reason}[] }`.
- Belegtext ist `source_cache.content_md` + `items.excerpt` + `findings.summary` + `findings.evidence_json` des Items.
- Schemafehler (kein Array, `value` nicht endlich, Label leer oder zu lang) führen zum Verwerfen mit Grund `invalid`.
- Ein Wert gilt als belegt, wenn eine seiner Schreibweisen im Belegtext steht und davor und danach keine Ziffer, kein `.` und kein `,` mit nachfolgender Ziffer steht. Schreibweisen:
  - Ganzzahlen: `1234`, `1,234`, `1.234`, `1 234`
  - Dezimalzahlen: `72.5`, `72,5`
  - Suffixe: `1.2k`/`1.2K`, `3M`, `4B`, `4bn`, `4 billion`, `3 million`
  - Ein `%` hinter der Zahl ist optional.
  Grund bei Fehlschlag: `unsupported`.
- Ist der Belegtext leer, werden alle Einträge mit `no_evidence` verworfen. Einträge jenseits von `FIGURES_MAX` werden mit `over_limit` verworfen.
- `present_news` speichert nur `kept` in `props_json`. Ist `dropped` nicht leer, endet die Tool-Antwort mit `Dropped figures: <label> <value> (<reason>), …`.

Darstellung:
- Browser: `FiguresBlock.vue` mit `compact` zeigt in `CardView.vue` höchstens 3 Werte als Zeile (D9), ohne `compact` in `CardDetailDialog.vue` die volle Darstellung. Bei leerem `figures` erscheint nichts. Einträge mit gleicher `unit` und gleicher `group`, mindestens 2 pro Gruppe, werden zum `BarChart` je Gruppe. Der Rest wird eine zweispaltige Zahlentabelle.
- TUI: Zeilen der Form `label ……… value unit`. Für Balkengruppen hängt `▇` an, skaliert auf 20 Zeichen.

Akzeptanz:
- `figures.test.ts` deckt jede Schreibweise, die Grenzfälle `5` vs. `2025` und `72` vs. `72.5`, `no_evidence`, `over_limit` und `invalid` ab.
- `sweep-faux.test.ts`: die Fixture enthält eine belegte und eine erfundene Zahl. Die Karte hält nur die belegte, die Tool-Antwort nennt die erfundene.
- `apps/dna-client-tui/tests/render.test.ts` bekommt einen Fall mit `figures`.
- `ui-faux.mjs`: eine Fixture-Karte mit `figures` rendert ein `BarChart`.

## P3 — Dashboard

Zieldateien: `apps/shared/packages/dna-sdk/src/routes.ts`, `src/wire.ts`, neu `apps/dna-server-api/src/routes/stats.ts`, neu `src/db/repos/stats.ts`, Routen-Registrierung in dna-server-api, `apps/dna-client-browser/fe/src/client/route.ts`, `components/TopBar.vue`, neu `components/DashboardView.vue`, `App.vue`.

API `GET /v1/stats?days=N` (N ganzzahlig 1–30, Default 7, sonst 400):
```ts
interface Stats {
  window: { from: string; to: string; days: number };
  topics: { topic: string; day: string; count: number; avgAttention: number | null }[];
  funnel: {
    total: { gathered: number; kept: number; duplicates: number; candidates: number; presented: number };
    sweeps: { id: number; startedAt: string; gathered: number; kept: number; duplicates: number; candidates: number; presented: number }[];
  };
  hfs: {
    byDay: { day: string; hype: number; facts: number; signal: number; n: number }[];
    bySource: { source: string; hype: number; facts: number; signal: number; n: number }[];
    primary: { category: "hype" | "facts" | "signal"; count: number }[];
  };
  feedback: {
    byDay: { day: string; more: number; less: number }[];
    byJudge: { judge: "hype" | "facts" | "signal"; n: number; humanHype: number; humanFacts: number; humanSignal: number; hits: number }[];
    agreement: number | null;
  };
}
```
- Tage werden in UTC gezählt. `hfs` nutzt pro Item die jüngste `classifications`-Zeile. Items ohne `matched_topic` laufen unter `(none)`.
- `feedback.signal` hat die Werte `more`/`less` (oder `NULL` bei reinem Label-Feedback). `byDay` zählt sie je Tag.
- `feedback.labels_json` ist eine Mehrfachauswahl aus `hype`/`facts`/`signal`. Pro Karte zählt das jüngste Feedback mit nicht leerem Label-Set. `byJudge` gruppiert nach Karten-`primary_category`: `n` Karten, `human*` = wie oft das Label im Set vorkommt, `hits` = Karten, deren Richter-Primärkategorie im Set liegt. `agreement` = Σhits / Σn, bei n=0 `null`.

Browser:
- Neue Route `#/dashboard` in `route.ts` und ein Eintrag in `TopBar.vue`.
- `DashboardView.vue` mit Umschalter 1/7/30 Tage und vier Kacheln:
  - Themen als `Heatmap` (Zeilen sind Themen, Spalten Tage, Wert ist count, `title` zeigt avgAttention). Ein Zellklick öffnet `searchFor(topic)` (D10).
  - Trichter als `Funnel` über `total` plus `Sparkline` aus `presented/gathered` je Sweep. Ein Klick auf einen Sweep führt zu `#/executions/sweep/<id>`.
  - H/F/S als `StackedLine` über `byDay` und eine Quellen-Tabelle sortiert nach `signal − hype`.
  - Feedback als Tabelle `byJudge` (Richter-Kategorie gegen Häufigkeit deiner Labels, Trefferquote je Zeile) mit `agreement` als Kennzahl und `BarChart` more/less je Tag.
- Leere Daten zeigen pro Kachel „Keine Daten im Zeitraum“.

Akzeptanz:
- `stats.test.ts` mit Fixture-DB deckt jeden Block, die Fenstergrenzen, das 400 bei `days=0` und `days=31`, `agreement=null` ohne Labels, Mehrfach-Labels, jüngstes Feedback pro Karte und Items ohne Thema ab.
- Die Antwortzeit gegen eine Kopie von live/dna.sqlite liegt unter 200 ms. Wird das verfehlt, kommen Indizes hinzu.
- `ui-faux.mjs` rendert `#/dashboard` mit vier Kacheln ohne Konsolenfehler.

## Verifikation (gesamt)

- `npm test --workspaces --if-present`
- `npm run check --workspace dna-client-browser`
- `npm test --workspace dna-client-browser` (UI-Faux-Suite, Chrome)
- `just combos dev`: Sichtprüfung von Feed (gerendertes Bild, FiguresBlock) und `#/dashboard`.

## Nicht im Umfang

Lokale oder HF-Bildgenerierung, Label-zu-Zahl-Prüfung, Live-Updates des Dashboards, Dashboard in CLI/TUI, Export.

## Annahmen

- Das Repo hat kein `repo.yaml`. Angenommen werden `main_branch=main`, `tickets=none`, `task_runner=just`/npm, keine generierten Artefakte.
- `@resvg/resvg-js` liefert ein Prebuilt-Binary für linux-x64 (WSL) und darwin-arm64.
