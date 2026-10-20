<script setup lang="ts">
// Several series over shared x labels, one polyline each, with a small legend.
import { computed } from "vue";
import { path } from "./scale";

const props = defineProps<{
  x: string[];
  series: { name: string; values: number[]; color: string }[];
}>();
const W = 420;
const H = 120;
const max = computed(() => Math.max(...props.series.flatMap((s) => s.values), 1));
</script>

<template>
  <svg
    class="viz viz-line"
    role="img"
    :aria-label="series.map((s) => s.name).join(', ') + ` over ${x.length} days`"
    :viewBox="`0 0 ${W} ${H + 20}`"
  >
    <path
      v-for="s in series"
      :key="s.name"
      :d="path(s.values, W, H, max)"
      fill="none"
      :stroke="s.color"
      stroke-width="2"
    />
    <g v-for="(s, i) in series" :key="`l-${s.name}`" :transform="`translate(${i * 90} ${H + 16})`">
      <rect width="10" height="3" y="-4" :fill="s.color" />
      <text class="viz-label" x="14" y="0">{{ s.name }}</text>
    </g>
  </svg>
</template>
