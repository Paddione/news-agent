<script setup lang="ts">
// Stages as shrinking bars; each shows its count and its share of the stage before.
import { computed } from "vue";
import { fmt, linear, share } from "./scale";

const props = defineProps<{ stages: { label: string; value: number }[] }>();
const w = computed(() => linear(props.stages[0]?.value ?? 0, 100));
</script>

<template>
  <div
    class="viz viz-funnel"
    role="img"
    :aria-label="stages.map((s) => `${s.label} ${s.value}`).join(', ')"
  >
    <div v-for="(s, i) in stages" :key="s.label" class="viz-funnel-row">
      <span class="viz-label">{{ s.label }}</span>
      <span class="viz-funnel-bar" :style="{ width: `${Math.max(1, w(s.value))}%` }" />
      <span class="viz-value"
        >{{ fmt(s.value) }} <small v-if="i">{{ share(s.value, stages[i - 1].value) }}</small></span
      >
    </div>
  </div>
</template>
