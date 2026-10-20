<script setup lang="ts">
// A tiny line without axes.
import { path } from "./scale";

defineProps<{ values: number[]; color?: string }>();
</script>

<template>
  <svg
    class="viz viz-spark"
    role="img"
    :aria-label="`trend of ${values.length} points`"
    viewBox="0 0 120 24"
    width="120"
    height="24"
  >
    <path
      :d="path(values, 120, 22)"
      fill="none"
      :stroke="color ?? 'var(--accent)'"
      stroke-width="1.5"
      transform="translate(0 1)"
    />
  </svg>
</template>
