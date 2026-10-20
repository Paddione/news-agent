# P3 — Dashboard

Spec: `design.md` §P3, D7, D10. Abhängig von P0 (Viz-Komponenten) und P2 Task 5 (gleiche Datei `ui-faux.mjs`).

## Task 1: `StatsRepo` und Typ `Stats`

**Files:**
- Modify: `apps/shared/packages/dna-sdk/src/wire.ts` (Typ `Stats` am Dateiende)
- Create: `apps/dna-server-api/src/db/repos/stats.ts`
- Test: `apps/dna-server-api/tests/stats.test.ts`

**Interfaces:**
- Produces (SDK): `Stats` exakt wie im Spec §P3, mit `feedback.byDay: { day; more; less }[]` und `feedback.byJudge`.
- Produces (Server):
  - `class StatsRepo { constructor(db: DatabaseSync); stats(days: number, now?: Date): Stats }`
  - `windowStart(days: number, now: Date): string` liefert den ISO-String von UTC-Mitternacht des Tages `now - (days - 1)`.

Datenregeln (aus Spec und Live-Schema):
- `topics`: alle `items` mit `created_at >= from`, gruppiert nach `COALESCE(matched_topic, '(none)')` und `substr(created_at, 1, 10)`. `avgAttention` ist `AVG(attention)`, bei nur `NULL`-Werten `null`.
- `funnel.sweeps`: `sweeps` mit `created_at >= from`, sortiert nach `id`. `startedAt` ist `COALESCE(started_at, created_at)`. `total` ist die Summe über diese Sweeps.
- `hfs`: pro Item die jüngste `classifications`-Zeile mit `command = 'hfs'` und `created_at >= from`. `byDay` nimmt den Tag der Klassifikation, `bySource` nutzt `COALESCE(items.source_name, '(unknown)')`. Die Mittelwerte werden auf 1 Nachkommastelle gerundet. `primary` zählt `primary_category`.
- `feedback.byDay`: `feedback` mit `created_at >= from` und `signal IN ('more','less')`.
- `feedback.byJudge`: Für jede Karte zählt die jüngste Feedback-Zeile mit `created_at >= from` und einem nicht leeren `labels_json`-Array. Die Kategorie ist `cards.primary_category`, Karten ohne Kategorie fallen weg. `hits` heißt: Die Kategorie liegt in den Labels. `agreement` ist `Σhits / Σn`, gerundet auf 2 Nachkommastellen, bei `Σn = 0` `null`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/dna-server-api/tests/stats.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { StatsRepo, windowStart } from "../src/db/repos/stats.ts";
import { tempStore } from "./helpers.ts";

const NOW = new Date("2026-10-20T12:00:00Z");
const hfs = (primary: "hype" | "facts" | "signal", h: number, f: number, s: number) => ({
  hype: h, facts: f, signal: s, primary, labels: [primary],
  ranked: [{ category: primary, score: 90, confidence: 0.9 }], suspectCombo: false,
});

function seed() {
  const t = tempStore();
  const { store } = t;
  const at = (table: string, id: number, iso: string) =>
    store.db.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(iso, id);
  const item = (url: string, topic: string | undefined, day: string, source = "a.dev") => {
    const { item } = store.news.upsertItem({ url, title: url, sourceName: source });
    store.db.prepare("UPDATE items SET matched_topic = ?, attention = 50 WHERE id = ?").run(topic ?? null, item.id);
    at("items", item.id, `${day}T08:00:00Z`);
    return item.id;
  };
  const i1 = item("https://a.dev/1", "agents", "2026-10-20");
  const i2 = item("https://a.dev/2", "agents", "2026-10-19");
  const i3 = item("https://b.dev/3", undefined, "2026-10-20", "b.dev");
  item("https://a.dev/old", "agents", "2026-10-01");
  for (const [id, p, h, f, s] of [[i1, "signal", 10, 60, 90], [i2, "hype", 80, 20, 10], [i3, "facts", 5, 85, 30]] as const) {
    const c = store.news.addClassification({ itemId: id, command: "hfs", version: 1, hfs: hfs(p, h, f, s) });
    at("classifications", c.id, "2026-10-20T09:00:00Z");
  }
  const card = (itemId: number, primary: string) => {
    const { card } = store.news.addCard({ kind: "news", component: "brief", props: { title: "t", summary: "s" }, itemId, hfs: hfs(primary as "signal", 1, 1, 1), attention: 50 });
    return card.id;
  };
  const c1 = card(i1, "signal");
  const c2 = card(i2, "hype");
  store.taste.addFeedback(c1, { labels: ["facts"] });
  store.taste.addFeedback(c1, { labels: ["facts", "signal"] });
  store.taste.addFeedback(c2, { labels: ["facts"] });
  store.taste.addFeedback(c2, { signal: "less" });
  store.taste.addFeedback(c1, { signal: "more" });
  store.db.prepare("UPDATE feedback SET created_at = '2026-10-20T10:00:00Z'").run();
  return t;
}

test("windowStart is UTC midnight days-1 back", () => {
  assert.equal(windowStart(1, NOW), "2026-10-20T00:00:00.000Z");
  assert.equal(windowStart(7, NOW), "2026-10-14T00:00:00.000Z");
});

test("stats aggregates topics, hfs and feedback inside the window", () => {
  const { store, cleanup } = seed();
  try {
    const s = new StatsRepo(store.db).stats(7, NOW);
    assert.deepEqual(s.window, { from: "2026-10-14T00:00:00.000Z", to: NOW.toISOString(), days: 7 });
    assert.deepEqual(
      s.topics.map((t) => `${t.topic}:${t.day}:${t.count}`).sort(),
      ["(none):2026-10-20:1", "agents:2026-10-19:1", "agents:2026-10-20:1"],
      "the item from 10-01 is outside the window",
    );
    assert.deepEqual(s.hfs.byDay, [{ day: "2026-10-20", hype: 31.7, facts: 55, signal: 43.3, n: 3 }]);
    assert.deepEqual(s.hfs.primary.map((p) => `${p.category}:${p.count}`).sort(), ["facts:1", "hype:1", "signal:1"]);
    assert.deepEqual(s.feedback.byDay, [{ day: "2026-10-20", more: 1, less: 1 }]);
    const sig = s.feedback.byJudge.find((j) => j.judge === "signal")!;
    assert.deepEqual(sig, { judge: "signal", n: 1, humanHype: 0, humanFacts: 1, humanSignal: 1, hits: 1 }, "latest labelled feedback wins");
    const hype = s.feedback.byJudge.find((j) => j.judge === "hype")!;
    assert.equal(hype.hits, 0);
    assert.equal(s.feedback.agreement, 0.5);
  } finally {
    cleanup();
  }
});

test("an empty db gives empty blocks and agreement null", () => {
  const { store, cleanup } = tempStore();
  try {
    const s = new StatsRepo(store.db).stats(1, NOW);
    assert.deepEqual(s.topics, []);
    assert.deepEqual(s.funnel.sweeps, []);
    assert.deepEqual(s.funnel.total, { gathered: 0, kept: 0, duplicates: 0, candidates: 0, presented: 0 });
    assert.deepEqual(s.hfs.byDay, []);
    assert.deepEqual(s.feedback.byJudge, []);
    assert.equal(s.feedback.agreement, null);
  } finally {
    cleanup();
  }
});

```

Vor dem Test prüfen:
- Die Signatur von `store.news.addCard` (`src/db/repos/news.ts:941`). Fehlende Pflichtfelder wie `toolCallId`, `conversationId` oder `sweepId` mit Testwerten ergänzen.
- Ob `addCard` `cards.primary_category` aus `hfs.primary` setzt (`grep -n primary_category src/db/repos/news.ts`). Falls nicht, im Seed `UPDATE cards SET primary_category = ? WHERE id = ?` ausführen.

Die erwarteten Werte von `hfs.byDay`: hype (10+80+5)/3 = 31.7, facts (60+20+85)/3 = 55, signal (90+10+30)/3 = 43.3.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dna-server-api && npx tsx --test tests/stats.test.ts`
Expected: FAIL with `Cannot find module '../src/db/repos/stats.ts'`

- [ ] **Step 3: Write minimal implementation**

`wire.ts` (Ende):
```ts
export type HfsName = "hype" | "facts" | "signal";
export interface FunnelCounts { gathered: number; kept: number; duplicates: number; candidates: number; presented: number }
export interface Stats {
  window: { from: string; to: string; days: number };
  topics: { topic: string; day: string; count: number; avgAttention: number | null }[];
  funnel: { total: FunnelCounts; sweeps: ({ id: number; startedAt: string } & FunnelCounts)[] };
  hfs: {
    byDay: { day: string; hype: number; facts: number; signal: number; n: number }[];
    bySource: { source: string; hype: number; facts: number; signal: number; n: number }[];
    primary: { category: HfsName; count: number }[];
  };
  feedback: {
    byDay: { day: string; more: number; less: number }[];
    byJudge: { judge: HfsName; n: number; humanHype: number; humanFacts: number; humanSignal: number; hits: number }[];
    agreement: number | null;
  };
}
```
Gibt es in `wire.ts` oder `api.ts` schon einen Namen `HfsName` oder `FunnelCounts`, den vorhandenen `HfsCategory` aus `api.ts` nutzen und keinen Doppeltyp anlegen.

```ts
// apps/dna-server-api/src/db/repos/stats.ts
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

    const topics = all<{ topic: string; day: string; count: number; avgAttention: number | null }>(
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
    const total: FunnelCounts = { gathered: 0, kept: 0, duplicates: 0, candidates: 0, presented: 0 };
    for (const s of sweeps) for (const k of Object.keys(total) as (keyof FunnelCounts)[]) total[k] += s[k];

    const avgBy = (key: string) =>
      all<{ k: string; hype: number; facts: number; signal: number; n: number }>(
        `SELECT ${key} AS k, AVG(hype) AS hype, AVG(facts) AS facts, AVG(signal) AS signal, COUNT(*) AS n
           FROM (${LATEST_HFS}) GROUP BY 1 ORDER BY 1`,
      ).map(({ k, ...v }) => ({ k, hype: r1(v.hype)!, facts: r1(v.facts)!, signal: r1(v.signal)!, n: v.n }));
    const byDay = avgBy("substr(created_at, 1, 10)").map(({ k, ...v }) => ({ day: k, ...v }));
    const bySource = avgBy("source").map(({ k, ...v }) => ({ source: k, ...v }));
    const primary = all<{ category: HfsName; count: number }>(
      `SELECT primary_category AS category, COUNT(*) AS count FROM (${LATEST_HFS}) GROUP BY 1 ORDER BY 1`,
    );

    const fbDay = all<{ day: string; more: number; less: number }>(
      `SELECT substr(created_at, 1, 10) AS day, SUM(signal = 'more') AS more, SUM(signal = 'less') AS less
         FROM feedback WHERE created_at >= :from AND signal IN ('more', 'less') GROUP BY 1 ORDER BY 1`,
    );
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
      const row = judges.get(judge) ?? { judge, n: 0, humanHype: 0, humanFacts: 0, humanSignal: 0, hits: 0 };
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
      feedback: { byDay: fbDay, byJudge, agreement: n ? Math.round((hits / n) * 100) / 100 : null },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dna-server-api && npx tsx --test tests/stats.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/shared/packages/dna-sdk/src/wire.ts apps/dna-server-api/src/db/repos/stats.ts apps/dna-server-api/tests/stats.test.ts
git commit -m "feat(stats): aggregate topics, sweep funnel, H/F/S and judge agreement for the dashboard"
```

## Task 2: Route `GET /v1/stats` und `DnaClient.stats`

**Files:**
- Modify: `apps/shared/packages/dna-sdk/src/routes.ts` (Eintrag vor `"images.get"`)
- Modify: `apps/shared/packages/dna-sdk/src/client.ts` (Methode neben `usage`)
- Create: `apps/dna-server-api/src/routes/stats.ts`
- Modify: `apps/dna-server-api/src/app.ts` (Import und `...statsRoutes(deps)`)
- Test: `apps/dna-server-api/tests/stats.test.ts` (neuer Test am Ende)

**Interfaces:**
- Consumes: `StatsRepo` (Task 1), `invalid` aus `src/errors.ts`.
- Produces: Route-ID `"stats"`, `parseDays(raw: unknown): number`, `DnaClient.stats(days?: number): Promise<Stats>`.

- [ ] **Step 1: Write the failing test** (Import oben in `tests/stats.test.ts` ergänzen, Test am Ende)

```ts
import { parseDays } from "../src/routes/stats.ts";
test("parseDays defaults to 7 and refuses values outside 1..30", () => {
  assert.equal(parseDays(undefined), 7);
  assert.equal(parseDays("30"), 30);
  for (const bad of ["0", "31", "2.5", "x", ""]) assert.throws(() => parseDays(bad), /days must be an integer from 1 to 30/);
});
```

Run: `cd apps/dna-server-api && npx tsx --test tests/stats.test.ts`
Expected: FAIL with `Cannot find module '../src/routes/stats.ts'`

- [ ] **Step 2: Write minimal implementation**

`routes.ts`, vor `"images.get"`:
```ts
  stats: {
    method: "GET",
    path: "/v1/stats",
    scope: "read",
    summary: "Dashboard aggregates over 1 to 30 days: topics, funnel, H/F/S, judge agreement",
  },
```
`client.ts`, neben der `usage`-Methode:
```ts
  stats(days?: number) {
    return this.call<Stats>("stats", { query: { days } });
  }
```
(`Stats` im Import aus `./wire.ts` ergänzen.)

```ts
// apps/dna-server-api/src/routes/stats.ts
// GET /v1/stats?days=N: the dashboard's aggregates.
import { invalid } from "../errors.ts";
import { StatsRepo } from "../db/repos/stats.ts";
import type { Handlers, RouteDeps } from "./types.ts";

export function parseDays(raw: unknown): number {
  if (raw === undefined) return 7;
  const days = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw invalid("days must be an integer from 1 to 30");
  return days;
}

export function statsRoutes({ app }: RouteDeps): Handlers<"stats"> {
  const repo = new StatsRepo(app.store.db);
  return { stats: (req, res) => res.json(repo.stats(parseDays(req.query.days))) };
}
```
`app.ts`: `import { statsRoutes } from "./routes/stats.ts";` und `...statsRoutes(deps),` nach `...logRoutes(deps),`.

`invalid(...)` liefert laut `src/errors.ts` einen 400er. Prüfen mit `grep -n "export function invalid" -A3 src/errors.ts`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd apps/dna-server-api && npx tsx --test tests/stats.test.ts tests/auth.test.ts && npm run check -w dna-server-api`
Expected: PASS. `auth.test.ts` deckt ab, dass jede `ROUTES`-Route einen Handler und eine Scope-Prüfung hat.

- [ ] **Step 4: Commit**

```bash
git add apps/shared/packages/dna-sdk/src/routes.ts apps/shared/packages/dna-sdk/src/client.ts apps/dna-server-api/src/routes/stats.ts apps/dna-server-api/src/app.ts
git commit -m "feat(stats): serve GET /v1/stats with a 1 to 30 day window"
```

## Task 3: Dashboard-Ansicht im Browser

**Files:**
- Modify: `apps/dna-client-browser/fe/src/client/route.ts`
- Create: `apps/dna-client-browser/fe/src/components/DashboardView.vue`
- Modify: `apps/dna-client-browser/fe/src/components/TopBar.vue` (Button in `.topbar-right` vor dem Settings-Button)
- Modify: `apps/dna-client-browser/fe/src/App.vue` (`<DashboardView v-if="route.view === 'dashboard'" />` neben `ExecutionsView`)
- Modify: `apps/dna-client-browser/fe/src/styles/app.css` (Block `.dashboard*` am Ende)
- Test: `apps/dna-client-browser/tests/ui-faux.mjs` (Check-Block nach dem P2-Block)

**Interfaces:**
- Consumes: `api.stats(days)` aus `client/store` (`api` ist der `DnaClient`), `attempt`, `go`, `searchFor` aus `client/layout`, Viz-Komponenten aus P0.
- Produces: Route `{ view: "dashboard" }` für `#/dashboard`. `DashboardView` hat die Wurzel `<section class="dashboard">` mit vier `<article class="dash-tile">`, jedes mit `data-tile="topics|funnel|hfs|feedback"`.

- [ ] **Step 1: Write the failing UI check** (in `ui-faux.mjs` nach dem P2-Block, vor `console.log("ALL PASS")`)

```js
// Dashboard: four tiles, no console errors, the window switch reloads.
{
  const errors = [];
  const onError = (m) => m.type() === "error" && errors.push(m.text());
  page.on("console", onError);
  await page.locator('button[aria-label="Dashboard"]').click();
  await page.locator(".dashboard .dash-tile").first().waitFor();
  check((await page.locator(".dashboard .dash-tile").count()) === 4, "dashboard has four tiles");
  await page.locator('.dashboard button[data-days="30"]').click();
  await page.locator('.dashboard button[data-days="30"][aria-pressed="true"]').waitFor();
  check(errors.length === 0, `dashboard renders four tiles without console errors${errors.length ? `: ${errors[0]}` : ""}`);
  page.off("console", onError);
  await page.evaluate(() => (location.hash = "#/"));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build -w dna-client-browser && node apps/dna-client-browser/tests/ui-faux.mjs`
Expected: FAIL. Timeout auf `button[aria-label="Dashboard"]`.

- [ ] **Step 3: Write minimal implementation**

`route.ts`:
```ts
export type Route =
  | { view: "main" }
  | { view: "dashboard" }
  | { view: "executions"; kind?: "run" | "tool" | "sweep" | "usage" | "logs"; id?: number };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "dashboard") return { view: "dashboard" };
  if (parts[0] !== "executions") return { view: "main" };
  const kind = parts[1] as "run" | "tool" | "sweep" | "usage" | "logs" | undefined;
  return { view: "executions", kind, id: parts[2] ? Number(parts[2]) : undefined };
}
```
Die Kopfzeile ergänzen: `#/dashboard is the dashboard.`

```vue
<!-- apps/dna-client-browser/fe/src/components/DashboardView.vue -->
<script setup lang="ts">
// The dashboard: what topics are running, how much each sweep filters, H/F/S over time and by source, and how often
// the judge agrees with your labels. Loaded on open and on a window change, not streamed.
import { computed, ref, watch } from "vue";
import { X } from "@lucide/vue";
import type { Stats } from "@dna/sdk";
import { go } from "../client/route";
import { searchFor } from "../client/layout";
import { api, attempt } from "../client/store";
import BarChart from "./viz/BarChart.vue";
import Funnel from "./viz/Funnel.vue";
import Heatmap from "./viz/Heatmap.vue";
import Sparkline from "./viz/Sparkline.vue";
import StackedLine from "./viz/StackedLine.vue";
import { share } from "./viz/scale";

const days = ref(7);
const stats = ref<Stats>();
watch(days, async (d) => (stats.value = await attempt(() => api.stats(d))), { immediate: true });

const topicRows = computed(() => [...new Set(stats.value?.topics.map((t) => t.topic))]);
const topicCols = computed(() => [...new Set(stats.value?.topics.map((t) => t.day))].sort());
const topicCells = computed(() =>
  (stats.value?.topics ?? []).map((t) => ({
    row: t.topic,
    col: t.day,
    value: t.count,
    title: `${t.topic} ${t.day}: ${t.count} items, attention ${t.avgAttention ?? "n/a"}`,
  })),
);
const funnel = computed(() => {
  const t = stats.value?.funnel.total;
  return t
    ? [
        { label: "Gathered", value: t.gathered },
        { label: "Kept", value: t.kept },
        { label: "Candidates", value: t.candidates },
        { label: "Presented", value: t.presented },
      ]
    : [];
});
const sweepShare = computed(() =>
  (stats.value?.funnel.sweeps ?? []).map((s) => (s.gathered ? s.presented / s.gathered : 0)),
);
const hfsX = computed(() => (stats.value?.hfs.byDay ?? []).map((d) => d.day));
const hfsSeries = computed(() => {
  const d = stats.value?.hfs.byDay ?? [];
  return [
    { name: "Signal", values: d.map((x) => x.signal), color: "var(--signal)" },
    { name: "Facts", values: d.map((x) => x.facts), color: "var(--facts)" },
    { name: "Hype", values: d.map((x) => x.hype), color: "var(--hype)" },
  ];
});
const sources = computed(() =>
  [...(stats.value?.hfs.bySource ?? [])].sort((a, b) => b.signal - b.hype - (a.signal - a.hype)).slice(0, 12),
);
const moreLess = computed(() =>
  (stats.value?.feedback.byDay ?? []).flatMap((d) => [
    { label: `${d.day.slice(5)} more`, value: d.more },
    { label: `${d.day.slice(5)} less`, value: d.less },
  ]),
);
const openTopic = (topic: string) => {
  go("/");
  if (topic !== "(none)") searchFor(topic);
};
</script>

<template>
  <section class="dashboard" aria-label="Dashboard">
    <header class="dashboard-head">
      <h2>Dashboard</h2>
      <div class="dashboard-window" role="group" aria-label="Window">
        <button v-for="d in [1, 7, 30]" :key="d" class="bar-button" :data-days="d" :aria-pressed="days === d" @click="days = d">
          {{ d }}d
        </button>
      </div>
      <button class="icon-button" aria-label="Close the dashboard" @click="go('/')"><X :size="18" /></button>
    </header>
    <div class="dashboard-grid">
      <article class="dash-tile" data-tile="topics">
        <h3>Topics by day</h3>
        <Heatmap v-if="topicCells.length" :rows="topicRows" :cols="topicCols" :cells="topicCells" @select="openTopic" />
        <p v-else class="dash-empty">Keine Daten im Zeitraum</p>
      </article>
      <article class="dash-tile" data-tile="funnel">
        <h3>Sweep funnel</h3>
        <template v-if="stats?.funnel.sweeps.length">
          <Funnel :stages="funnel" />
          <p class="dash-note">
            Presented per gathered, per sweep <Sparkline :values="sweepShare" />
            <a v-for="s in stats.funnel.sweeps.slice(-5)" :key="s.id" :href="`#/executions/sweep/${s.id}`">#{{ s.id }}</a>
          </p>
        </template>
        <p v-else class="dash-empty">Keine Daten im Zeitraum</p>
      </article>
      <article class="dash-tile" data-tile="hfs">
        <h3>Hype, Facts, Signal</h3>
        <template v-if="hfsX.length">
          <StackedLine :x="hfsX" :series="hfsSeries" />
          <table class="dash-table">
            <tr><th>Source</th><th>Signal</th><th>Facts</th><th>Hype</th><th>n</th></tr>
            <tr v-for="s in sources" :key="s.source">
              <td>{{ s.source }}</td><td>{{ s.signal }}</td><td>{{ s.facts }}</td><td>{{ s.hype }}</td><td>{{ s.n }}</td>
            </tr>
          </table>
        </template>
        <p v-else class="dash-empty">Keine Daten im Zeitraum</p>
      </article>
      <article class="dash-tile" data-tile="feedback">
        <h3>Judge vs. your labels</h3>
        <template v-if="stats?.feedback.byJudge.length || moreLess.length">
          <p class="dash-kpi">
            Agreement <strong>{{ stats?.feedback.agreement === null ? "–" : share(stats!.feedback.agreement!, 1) }}</strong>
          </p>
          <table v-if="stats?.feedback.byJudge.length" class="dash-table">
            <tr><th>Judge</th><th>n</th><th>you: hype</th><th>facts</th><th>signal</th><th>hit rate</th></tr>
            <tr v-for="j in stats!.feedback.byJudge" :key="j.judge">
              <td :class="j.judge">{{ j.judge }}</td><td>{{ j.n }}</td><td>{{ j.humanHype }}</td>
              <td>{{ j.humanFacts }}</td><td>{{ j.humanSignal }}</td><td>{{ share(j.hits, j.n) }}</td>
            </tr>
          </table>
          <BarChart v-if="moreLess.length" :rows="moreLess" />
        </template>
        <p v-else class="dash-empty">Keine Daten im Zeitraum</p>
      </article>
    </div>
  </section>
</template>
```

`TopBar.vue`: `LayoutDashboard` zum `@lucide/vue`-Import und `go` aus `../client/route` ergänzen, dann vor dem Settings-Button:
```vue
      <button class="bar-button" aria-label="Dashboard" title="Dashboard" @click="go('/dashboard')">
        <LayoutDashboard :size="16" />
      </button>
```
`App.vue`: `import DashboardView from "./components/DashboardView.vue";` und `<DashboardView v-if="route.view === 'dashboard'" />` direkt nach `<ExecutionsView .../>`.

CSS am Ende von `app.css`. Das Overlay-Verhalten kommt aus `ExecutionsView` (`grep -n "\.executions" fe/src/styles/app.css`): dieselbe Positionierung übernehmen, falls dort `position: fixed` genutzt wird.
```css
.dashboard { position: fixed; inset: 48px 0 0 0; z-index: 20; overflow: auto; background: var(--bg); padding: 16px; }
.dashboard-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.dashboard-head h2 { margin: 0; flex: 1; font-size: 18px; }
.dashboard-window button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 12px; }
.dash-tile { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; min-width: 0; }
.dash-tile h3 { margin: 0 0 8px; font-size: 14px; }
.dash-empty, .dash-note { color: var(--muted); font-size: 12px; }
.dash-note a { margin-left: 6px; }
.dash-table { width: 100%; font-size: 12px; border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; }
.dash-table th, .dash-table td { text-align: left; padding: 2px 6px; border-bottom: 1px solid var(--line); }
.dash-table td.signal { color: var(--signal); } .dash-table td.facts { color: var(--facts); } .dash-table td.hype { color: var(--hype); }
@media (max-width: 520px) { .dashboard-grid { grid-template-columns: 1fr; } }
```
Die Variablennamen `--bg`, `--muted` und `--text` gegen `tokens.css` prüfen und die vorhandenen Namen verwenden. Den Wert `48px` an die tatsächliche Höhe von `.topbar` anpassen (`grep -n "\.topbar {" -A6 fe/src/styles/app.css`).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run check -w dna-client-browser && npm run build -w dna-client-browser && node apps/dna-client-browser/tests/ui-faux.mjs`
Expected: `PASS dashboard has four tiles`, `PASS dashboard renders four tiles without console errors`, `ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add apps/dna-client-browser/fe/src/client/route.ts apps/dna-client-browser/fe/src/components/DashboardView.vue apps/dna-client-browser/fe/src/components/TopBar.vue apps/dna-client-browser/fe/src/App.vue apps/dna-client-browser/fe/src/styles/app.css apps/dna-client-browser/tests/ui-faux.mjs
git commit -m "feat(browser): add a dashboard with topic heatmap, sweep funnel, H/F/S trends and judge agreement"
```
