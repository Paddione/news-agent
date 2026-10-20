# P0 — Geteilte Viz-Komponenten

Spec: `design.md` §P0, D6. Arbeitsverzeichnis: `apps/dna-client-browser`.

## Task 1: Skalierungs-Helfer mit Unit-Tests

**Files:**
- Create: `apps/dna-client-browser/fe/src/components/viz/scale.ts`
- Create: `apps/dna-client-browser/tests/scale.test.ts`
- Modify: `apps/dna-client-browser/package.json` (Script `test`)

**Interfaces:**
- Produces:
  - `linear(domainMax: number, rangeMax: number): (v: number) => number`: 0 → 0, `domainMax` → `rangeMax`. Bei `domainMax <= 0` liefert sie immer 0.
  - `path(values: number[], width: number, height: number, max?: number): string`: SVG-`d`-String, x gleichmäßig verteilt, y invertiert. Leeres Array ergibt `""`.
  - `fmt(v: number): string`: höchstens 1 Nachkommastelle, Tausendertrennung über `toLocaleString("en-US")`.
  - `share(part: number, whole: number): string`: `"–"` bei `whole <= 0`, sonst ganze Prozent mit `%`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/dna-client-browser/tests/scale.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fmt, linear, path, share } from "../fe/src/components/viz/scale.ts";

test("linear maps 0..max onto 0..range and is flat for an empty domain", () => {
  assert.equal(linear(10, 200)(5), 100);
  assert.equal(linear(0, 200)(5), 0);
});

test("path spreads points evenly and inverts y", () => {
  assert.equal(path([0, 10], 100, 50), "M0,50 L100,0");
  assert.equal(path([5], 100, 50, 10), "M0,25");
  assert.equal(path([], 100, 50), "");
});

test("fmt and share", () => {
  assert.equal(fmt(1234.56), "1,234.6");
  assert.equal(fmt(72), "72");
  assert.equal(share(1, 4), "25%");
  assert.equal(share(1, 0), "–");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dna-client-browser && npx tsx --test tests/scale.test.ts`
Expected: FAIL with `Cannot find module '../fe/src/components/viz/scale.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/dna-client-browser/fe/src/components/viz/scale.ts
// Pure helpers the viz components share: linear scales, an SVG line path, number and share formatting.

export const linear =
  (domainMax: number, rangeMax: number) =>
  (v: number): number =>
    domainMax <= 0 ? 0 : (v / domainMax) * rangeMax;

export function path(values: number[], width: number, height: number, max?: number): string {
  if (!values.length) return "";
  const top = max ?? Math.max(...values, 0);
  const y = linear(top, height);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i ? "L" : "M"}${Math.round(i * step)},${Math.round(height - y(v))}`)
    .join(" ");
}

export const fmt = (v: number): string =>
  (Math.round(v * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });

export const share = (part: number, whole: number): string =>
  whole <= 0 ? "–" : `${Math.round((part / whole) * 100)}%`;
```

In `apps/dna-client-browser/package.json` das Script ersetzen:
```json
"test": "tsx --test tests/*.test.ts && node tests/ui-faux.mjs"
```
`tsx` ist Root-DevDependency und im Workspace auflösbar.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dna-client-browser && npx tsx --test tests/scale.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dna-client-browser/fe/src/components/viz/scale.ts apps/dna-client-browser/tests/scale.test.ts apps/dna-client-browser/package.json
git commit -m "feat(viz): add shared scale helpers for inline SVG charts"
```

## Task 2: Viz-Komponenten

**Files:**
- Create: `apps/dna-client-browser/fe/src/components/viz/BarChart.vue`
- Create: `apps/dna-client-browser/fe/src/components/viz/Heatmap.vue`
- Create: `apps/dna-client-browser/fe/src/components/viz/Funnel.vue`
- Create: `apps/dna-client-browser/fe/src/components/viz/StackedLine.vue`
- Create: `apps/dna-client-browser/fe/src/components/viz/Sparkline.vue`
- Modify: `apps/dna-client-browser/fe/src/styles/app.css` (Block am Dateiende)

**Interfaces:**
- Consumes: `linear`, `path`, `fmt`, `share` aus Task 1.
- Produces (Props und Events, von P2/P3 genutzt):
  - `BarChart`: `{ rows: { label: string; value: number }[]; unit?: string; color?: string }`. Wurzel `<svg class="viz viz-bar">`.
  - `Heatmap`: `{ rows: string[]; cols: string[]; cells: { row: string; col: string; value: number; title?: string }[] }`, emit `select(row: string, col: string)`. Wurzel `<div class="viz viz-heatmap">`.
  - `Funnel`: `{ stages: { label: string; value: number }[] }`. Wurzel `<div class="viz viz-funnel">`.
  - `StackedLine`: `{ x: string[]; series: { name: string; values: number[]; color: string }[] }`. Wurzel `<svg class="viz viz-line">`.
  - `Sparkline`: `{ values: number[]; color?: string }`. Wurzel `<svg class="viz viz-spark">`.

Diese Komponenten haben keine eigenen Unit-Tests. Ihre Logik steckt in `scale.ts` (Task 1), das Rendern prüft die UI-Faux-Suite in P2 Task 5 und P3 Task 3.

- [ ] **Step 1: BarChart.vue**

```vue
<script setup lang="ts">
// Horizontal bars with the label left and the value at the bar's end; no legend.
import { computed } from "vue";
import { fmt, linear } from "./scale";

const props = defineProps<{ rows: { label: string; value: number }[]; unit?: string; color?: string }>();
const ROW = 22;
const LABEL = 160;
const WIDTH = 420;
const x = computed(() => linear(Math.max(...props.rows.map((r) => r.value), 0), WIDTH - LABEL - 64));
const summary = computed(() =>
  props.rows.map((r) => `${r.label} ${fmt(r.value)}${props.unit ?? ""}`).join(", "),
);
</script>

<template>
  <svg
    class="viz viz-bar"
    role="img"
    :aria-label="summary"
    :viewBox="`0 0 ${WIDTH} ${rows.length * ROW}`"
    :height="rows.length * ROW"
  >
    <g v-for="(r, i) in rows" :key="r.label" :transform="`translate(0 ${i * ROW})`">
      <text class="viz-label" x="0" y="15">{{ r.label }}</text>
      <rect :x="LABEL" y="4" :width="Math.max(1, x(r.value))" height="14" rx="2" :fill="color ?? 'var(--accent)'" />
      <text class="viz-value" :x="LABEL + x(r.value) + 6" y="15">{{ fmt(r.value) }}{{ unit ? ` ${unit}` : "" }}</text>
    </g>
  </svg>
</template>
```

- [ ] **Step 2: Heatmap.vue**

```vue
<script setup lang="ts">
// Rows by columns, cell intensity by value; a click emits select(row, col).
import { computed } from "vue";

const props = defineProps<{
  rows: string[];
  cols: string[];
  cells: { row: string; col: string; value: number; title?: string }[];
}>();
const emit = defineEmits<{ select: [row: string, col: string] }>();
const byKey = computed(() => new Map(props.cells.map((c) => [`${c.row}\u0000${c.col}`, c])));
const max = computed(() => Math.max(...props.cells.map((c) => c.value), 1));
const cell = (row: string, col: string) => byKey.value.get(`${row}\u0000${col}`);
</script>

<template>
  <div class="viz viz-heatmap" role="img" :aria-label="`${rows.length} topics over ${cols.length} days`">
    <div class="viz-heat-grid" :style="{ gridTemplateColumns: `160px repeat(${cols.length}, 1fr)` }">
      <span />
      <span v-for="c in cols" :key="c" class="viz-heat-col">{{ c.slice(5) }}</span>
      <template v-for="r in rows" :key="r">
        <span class="viz-label">{{ r }}</span>
        <button
          v-for="c in cols"
          :key="c"
          class="viz-heat-cell"
          :style="{ opacity: 0.12 + 0.88 * ((cell(r, c)?.value ?? 0) / max) }"
          :title="cell(r, c)?.title ?? `${r} ${c}: ${cell(r, c)?.value ?? 0}`"
          :aria-label="`${r} ${c}: ${cell(r, c)?.value ?? 0}`"
          @click="emit('select', r, c)"
        />
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Funnel.vue, StackedLine.vue, Sparkline.vue**

```vue
<!-- Funnel.vue -->
<script setup lang="ts">
// Stages as shrinking bars; each shows its count and its share of the stage before.
import { computed } from "vue";
import { fmt, linear, share } from "./scale";

const props = defineProps<{ stages: { label: string; value: number }[] }>();
const w = computed(() => linear(props.stages[0]?.value ?? 0, 100));
</script>

<template>
  <div class="viz viz-funnel" role="img" :aria-label="stages.map((s) => `${s.label} ${s.value}`).join(', ')">
    <div v-for="(s, i) in stages" :key="s.label" class="viz-funnel-row">
      <span class="viz-label">{{ s.label }}</span>
      <span class="viz-funnel-bar" :style="{ width: `${Math.max(1, w(s.value))}%` }" />
      <span class="viz-value">{{ fmt(s.value) }} <small v-if="i">{{ share(s.value, stages[i - 1].value) }}</small></span>
    </div>
  </div>
</template>
```

```vue
<!-- StackedLine.vue -->
<script setup lang="ts">
// Several series over shared x labels, one polyline each, with a small legend.
import { computed } from "vue";
import { path } from "./scale";

const props = defineProps<{ x: string[]; series: { name: string; values: number[]; color: string }[] }>();
const W = 420;
const H = 120;
const max = computed(() => Math.max(...props.series.flatMap((s) => s.values), 1));
</script>

<template>
  <svg class="viz viz-line" role="img" :aria-label="series.map((s) => s.name).join(', ') + ` over ${x.length} days`" :viewBox="`0 0 ${W} ${H + 20}`">
    <path v-for="s in series" :key="s.name" :d="path(s.values, W, H, max)" fill="none" :stroke="s.color" stroke-width="2" />
    <g v-for="(s, i) in series" :key="`l-${s.name}`" :transform="`translate(${i * 90} ${H + 16})`">
      <rect width="10" height="3" y="-4" :fill="s.color" /><text class="viz-label" x="14" y="0">{{ s.name }}</text>
    </g>
  </svg>
</template>
```

```vue
<!-- Sparkline.vue -->
<script setup lang="ts">
// A tiny line without axes.
import { path } from "./scale";

defineProps<{ values: number[]; color?: string }>();
</script>

<template>
  <svg class="viz viz-spark" role="img" :aria-label="`trend of ${values.length} points`" viewBox="0 0 120 24" width="120" height="24">
    <path :d="path(values, 120, 22)" fill="none" :stroke="color ?? 'var(--accent)'" stroke-width="1.5" transform="translate(0 1)" />
  </svg>
</template>
```

- [ ] **Step 4: CSS am Ende von `fe/src/styles/app.css`**

```css
/* Viz: shared chart parts */
.viz { display: block; max-width: 100%; }
.viz-label { font-size: 12px; fill: var(--muted); color: var(--muted); }
.viz-value { font-size: 12px; fill: var(--text); color: var(--text); font-variant-numeric: tabular-nums; }
.viz-heat-grid { display: grid; gap: 2px; align-items: center; }
.viz-heat-col { font-size: 11px; color: var(--muted); text-align: center; }
.viz-heat-cell { height: 18px; border: 0; border-radius: 2px; background: var(--accent); cursor: pointer; padding: 0; }
.viz-funnel-row { display: grid; grid-template-columns: 110px 1fr auto; gap: 8px; align-items: center; margin: 3px 0; }
.viz-funnel-bar { height: 12px; border-radius: 2px; background: var(--accent); }
```

Vor dem Einfügen `grep -n -- '--muted\|--text' fe/src/styles/tokens.css` ausführen. Heißen die Textvariablen anders, die vorhandenen Namen einsetzen und keine neuen anlegen.

- [ ] **Step 5: Typecheck**

Run: `npm run check -w dna-client-browser`
Expected: Exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/dna-client-browser/fe/src/components/viz apps/dna-client-browser/fe/src/styles/app.css
git commit -m "feat(viz): add BarChart, Heatmap, Funnel, StackedLine and Sparkline components"
```
