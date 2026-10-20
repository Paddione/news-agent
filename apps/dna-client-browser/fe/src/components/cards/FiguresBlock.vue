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
