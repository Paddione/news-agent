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
  <div
    class="viz viz-heatmap"
    role="img"
    :aria-label="`${rows.length} topics over ${cols.length} days`"
  >
    <div
      class="viz-heat-grid"
      :style="{ gridTemplateColumns: `160px repeat(${cols.length}, 1fr)` }"
    >
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
