---
title: Visuelle Inhalte im News-Agent (Kartenbild, Zahlen-Diagramme, Dashboard)
domains: [dna-server-api, dna-sdk, dna-client-browser, dna-client-tui]
status: staged
spec: .agents/plans/news-agent-visuals/design.md
branch: feature/news-agent-visuals
---

# news-agent-visuals — Implementation Plan

> **For agentic workers (any harness):** Read `HANDOFF.md` in this folder first. Execute task by task in the order given there, test first (red, then green), one commit per task, and tick each `- [ ]` step as you go. Claude Code may use superpowers:subagent-driven-development or superpowers:executing-plans; other harnesses use their own executor with the same order.

**Goal:** Jede Karte hat ein Bild ohne Bildmodell, Karten zeigen belegte Artikelzahlen, und ein Dashboard zeigt Themen, Trichter, H/F/S und Richter-Feedback.

**Architecture:** Server-seitig rendert `card-render.ts` ein SVG über resvg zu PNG, wenn keine Quellbild-Stufe greift. `figures.ts` prüft die Zahlen des Agents gegen den gecachten Artikeltext, bevor `present_news` sie speichert. `GET /v1/stats` aggregiert per SQL. Der Browser nutzt geteilte Inline-SVG-Komponenten unter `components/viz/`.

**Tech Stack:** Node 24, TypeScript, `node:test` via `tsx --test`, `node:sqlite`, Express 5, Vue 3.5, Vite, Playwright (UI-Faux-Suite), `@resvg/resvg-js`.

**Spec:** `.agents/plans/news-agent-visuals/design.md` (D1–D10)

## Global Constraints

- Node `>=24`, ESM, `.ts`-Imports mit Endung (Repo-Stil).
- Einzige neue Laufzeit-Abhängigkeit: `@resvg/resvg-js` (exakte Version pinnen, wie alle Deps im Repo).
- Keine DB-Migration (D8). Gerenderte Bilder: `origin='generated'`, `model='card-render@1'`.
- `FIGURES_MAX = 6`, `FIGURE_LABEL_MAX = 60`.
- `/v1/stats`: `days` ganzzahlig 1–30, Default 7, sonst HTTP 400. Tage in UTC.
- Keine neue Chart-Bibliothek. Farben nur aus `fe/src/styles/tokens.css` (`--signal`, `--facts`, `--hype`, `--line`, `--panel`, `--accent`, Textfarben).
- Kommentar-/Code-Stil: kurze Kopfzeilen-Kommentare pro Datei wie im Bestand, Formatierung via `npm run fmt`.

## Review Focus

1. Ein Artikel mit Jahreszahl `2025` und Agent-Zahl `5`: Die `5` muss verworfen werden (Test in P2 Task 1).
2. Ein Item ohne `cache_id` (z. B. aus `search_web`): `figures` → alles `no_evidence`, die Karte erscheint trotzdem (Test in P2 Task 2).
3. Ein Titel mit `&`, `<`, Emoji und 300 Zeichen ergibt ein gültiges SVG mit höchstens 4 Zeilen und Ellipse (Test in P1 Task 2).
4. Ein `og:image`, das eine HTML-Seite liefert: Die nächste Stufe greift, es entsteht kein kaputtes Bild (Test in P1 Task 1).
5. `/v1/stats` auf einer leeren DB: alle Arrays leer, `agreement: null`, keine Division durch 0, die UI zeigt „Keine Daten im Zeitraum“ (Tests in P3 Task 1 und Task 3).

## File Structure

| Datei | Partial | Art | Zweck |
|---|---|---|---|
| `apps/dna-client-browser/fe/src/components/viz/BarChart.vue` | P0 | neu | horizontale Balken |
| `apps/dna-client-browser/fe/src/components/viz/Heatmap.vue` | P0 | neu | Matrix mit Klick-Event |
| `apps/dna-client-browser/fe/src/components/viz/Funnel.vue` | P0 | neu | Stufen mit Anteil zur Vorstufe |
| `apps/dna-client-browser/fe/src/components/viz/StackedLine.vue` | P0 | neu | mehrere Linien über Tage |
| `apps/dna-client-browser/fe/src/components/viz/Sparkline.vue` | P0 | neu | Mini-Linie |
| `apps/dna-client-browser/fe/src/components/viz/scale.ts` | P0 | neu | reine Skalierungs-Helfer |
| `apps/dna-client-browser/fe/src/styles/app.css` | P0 | ändern | `.viz-*`-Regeln am Dateiende |
| `apps/dna-server-api/src/news/source-images.ts` | P1 | neu | Quellbild-Kandidaten (YouTube, GitHub, Markdown) |
| `apps/dna-server-api/src/news/card-render.ts` | P1 | neu | SVG-Karte + resvg-Rasterisierung |
| `apps/dna-server-api/src/news/images.ts` | P1 | ändern | Stufen in `resolve`, neues `fallback`/`render` |
| `apps/dna-server-api/assets/fonts/Inter-Regular.ttf`, `Inter-Bold.ttf`, `LICENSE.txt` | P1 | neu | gebündelte Schrift (OFL) |
| `apps/dna-server-api/scripts/backfill-rendered-images.ts` | P1 | neu | Backfill der 17 fehlgeschlagenen Bilder |
| `apps/dna-server-api/package.json` | P1 | ändern | `@resvg/resvg-js` |
| `apps/dna-server-api/tests/images.test.ts` | P1 | ändern | Stufen, Rendern, Backfill |
| `apps/dna-server-api/tests/card-render.test.ts` | P1 | neu | Umbruch, Escaping, PNG |
| `apps/shared/packages/dna-sdk/src/components.ts` | P2 | ändern | `Figure`, Limits, `figuresOf`, `figureGroups` |
| `apps/shared/packages/dna-sdk/tests/figures.test.ts` | P2 | neu | `figuresOf`/`figureGroups` |
| `apps/dna-server-api/src/news/figures.ts` | P2 | neu | `verifyFigures`, `evidenceText` |
| `apps/dna-server-api/tests/figures.test.ts` | P2 | neu | Normalisierung und Grenzen |
| `apps/dna-server-api/src/agents/tools/present.ts` | P2 | ändern | Check vor `addCard`, Hinweis in Tool-Antwort |
| `apps/dna-server-api/prompt_engineering/agents/news-desk/SYSTEM_PROMPT.md` | P2 | ändern | Regel für `figures` |
| `apps/dna-server-api/tests/tools.test.ts` | P2 | ändern | `present_news` mit `figures` |
| `apps/dna-client-browser/fe/src/components/cards/FiguresBlock.vue` | P2 | neu | kompakt / voll |
| `apps/dna-client-browser/fe/src/components/cards/CardView.vue` | P2 | ändern | kompakte Zeile |
| `apps/dna-client-browser/fe/src/components/CardDetailDialog.vue` | P2 | ändern | volle Darstellung |
| `apps/dna-client-tui/src/cards.ts` | P2 | ändern | `figureLines` |
| `apps/dna-client-tui/tests/render.test.ts` | P2 | ändern | Fall mit `figures` |
| `apps/shared/packages/dna-sdk/src/routes.ts` | P3 | ändern | Route `stats` |
| `apps/shared/packages/dna-sdk/src/wire.ts` | P3 | ändern | Typ `Stats` |
| `apps/shared/packages/dna-sdk/src/client.ts` | P3 | ändern | `DnaClient.stats(days)` |
| `apps/dna-server-api/src/db/repos/stats.ts` | P3 | neu | Aggregations-SQL |
| `apps/dna-server-api/src/routes/stats.ts` | P3 | neu | Handler `stats` |
| `apps/dna-server-api/src/app.ts` | P3 | ändern | `statsRoutes` einhängen |
| `apps/dna-server-api/tests/stats.test.ts` | P3 | neu | Blöcke, Fenster, 400 |
| `apps/dna-client-browser/fe/src/client/route.ts` | P3 | ändern | `#/dashboard` |
| `apps/dna-client-browser/fe/src/components/DashboardView.vue` | P3 | neu | vier Kacheln |
| `apps/dna-client-browser/fe/src/components/TopBar.vue` | P3 | ändern | Dashboard-Button |
| `apps/dna-client-browser/fe/src/App.vue` | P3 | ändern | View einhängen |
| `apps/dna-client-browser/tests/ui-faux.mjs` | P2+P3 | ändern | je ein Check-Block am Ende (P2 vor P3, sequenziell) |

## Partials

| Partial | Datei | Abhängig von | Parallel zu |
|---|---|---|---|
| P0 Viz-Komponenten | `tasks.d/p0-viz.md` | – | P1 |
| P1 Kartenbild | `tasks.d/p1-card-image.md` | – | P0, P2-Server-Tasks |
| P2 Zahlen | `tasks.d/p2-figures.md` | P0 (Task 4 nutzt `BarChart`) | P1 |
| P3 Dashboard | `tasks.d/p3-dashboard.md` | P0, P2 Task 5 (gemeinsame `ui-faux.mjs`) | – |

Reihenfolge bei sequentieller Ausführung: P0 → P1 → P2 → P3 → Task V.

`ui-faux.mjs` ist die einzige Datei mit zwei Partials. P2 hängt seinen Block vor P3 an, deshalb läuft P3 nach P2.

## Task V: Finale Verifikation

**Files:** keine Änderungen.

- [ ] **Step 1: Format und Lint**

Run: `npm run fmt && npm run fmt:check && npm run lint`
Expected: Exit 0, keine Lint-Fehler.

- [ ] **Step 2: Typecheck aller Workspaces**

Run: `npm run check`
Expected: Exit 0.

- [ ] **Step 3: Alle Unit-Suites**

Run: `npm test`
Expected: Alle Suites PASS, inklusive `images`, `card-render`, `figures` (Server und SDK), `tools`, `stats`, `render` (TUI), `sweep-faux`.

- [ ] **Step 4: UI-Faux-Suite**

Run: `npm run build -w dna-client-browser && node apps/dna-client-browser/tests/ui-faux.mjs`
Expected: endet mit `ALL PASS`, darunter `PASS figures render compact on the card and as bars in the detail dialog` und `PASS dashboard renders four tiles without console errors`.

- [ ] **Step 5: Stats-Laufzeit gegen Live-Kopie**

```bash
cp ~/news-agent-data/live/dna.sqlite /tmp/dna-stats-copy.sqlite
cd apps/dna-server-api && node --import tsx -e '
import { DatabaseSync } from "node:sqlite";
import { StatsRepo } from "./src/db/repos/stats.ts";
const r = new StatsRepo(new DatabaseSync("/tmp/dna-stats-copy.sqlite"));
const t = performance.now(); const s = r.stats(30); console.log(Math.round(performance.now() - t), "ms", s.topics.length, s.funnel.sweeps.length);'
```
Expected: unter 200 ms. Liegt der Wert darüber, `CREATE INDEX` in einer neuen Migration `002_stats_indexes.sql` für die im Plan von `stats.ts` gefilterten `created_at`-Spalten ergänzen und erneut messen.

- [ ] **Step 6: Sichtprüfung**

Run: `just combos dev`, dann `http://localhost:4851` öffnen.
Expected: Karten ohne Quellbild zeigen das gerenderte Bild (dunkel, Akzentstreifen links). Eine Karte mit `figures` zeigt die kompakte Zeile. Der Detail-Dialog zeigt Balken. `#/dashboard` zeigt vier Kacheln. Danach `just net down local`.

- [ ] **Step 7: Backfill-Trockenlauf auf Live**

Run: `cd apps/dna-server-api && node --import tsx scripts/backfill-rendered-images.ts --db ~/news-agent-data/live/dna.sqlite --dry-run`
Expected: `would render 17 images` (Anzahl laut F2, kann gewachsen sein). Den echten Lauf erst nach dem Merge ausführen, nicht im Plan.
