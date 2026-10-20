<script setup lang="ts">
// Horizontal bars with the label left and the value at the bar's end; no legend.
import { computed } from "vue";
import { fmt, linear } from "./scale";

const props = defineProps<{
  rows: { label: string; value: number }[];
  unit?: string;
  color?: string;
}>();
const ROW = 22;
const LABEL = 160;
const WIDTH = 420;
const x = computed(() =>
  linear(Math.max(...props.rows.map((r) => r.value), 0), WIDTH - LABEL - 64),
);
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
      <rect
        :x="LABEL"
        y="4"
        :width="Math.max(1, x(r.value))"
        height="14"
        rx="2"
        :fill="color ?? 'var(--accent)'"
      />
      <text class="viz-value" :x="LABEL + x(r.value) + 6" y="15">
        {{ fmt(r.value) }}{{ unit ? ` ${unit}` : "" }}
      </text>
    </g>
  </svg>
</template>
