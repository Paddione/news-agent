<script setup lang="ts">
// One news row: the rail on the left (when it was published, the primary H/F/S icon, the topic keyword) aligned
// with its card. Content is dated by when it was published, never by when the agent found it: no date reads "No date".
import { computed } from "vue";
import { BadgeCheck, Megaphone, Newspaper, Zap } from "@lucide/vue";
import type { Card } from "@dna/sdk";
import { highlighted } from "../client/layout";
import { clean } from "../client/text";
import CardView from "./cards/CardView.vue";

const props = defineProps<{ card: Card }>();
const ICONS = { signal: Zap, facts: BadgeCheck, hype: Megaphone };
const when = computed(() =>
  props.card.publishedAt ? new Date(props.card.publishedAt) : undefined,
);
/** A page that gives only a day is stored at UTC midnight: show that day, with no time and no zone shift. */
const dateOnly = computed(() => props.card.publishedAt?.endsWith("T00:00:00.000Z") ?? false);
const thisYear = (d: Date, utc: boolean) =>
  (utc ? d.getUTCFullYear() : d.getFullYear()) === new Date().getFullYear();
const time = computed(() =>
  !when.value
    ? "No date"
    : dateOnly.value
      ? when.value.toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" })
      : when.value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
);
const day = computed(() => {
  const d = when.value;
  if (!d) return "unknown";
  if (dateOnly.value) return thisYear(d, true) ? "" : String(d.getUTCFullYear());
  if (d.toDateString() === new Date().toDateString()) return "today";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: thisYear(d, false) ? undefined : "numeric",
  });
});
const primary = computed(() => props.card.hfs?.primary);
const keyword = computed(() => clean(props.card.topic ?? props.card.sourceName ?? "news"));
</script>

<template>
  <div class="feed-row" :class="{ highlight: highlighted === card.id }" :data-row="card.id">
    <div class="rail" aria-hidden="true">
      <time class="rail-time" :class="{ undated: !when }">{{ time }}<small>{{ day }}</small></time>
      <span class="rail-node" :class="primary ?? 'none'">
        <component :is="primary ? ICONS[primary] : Newspaper" :size="15" />
      </span>
      <span class="rail-keyword">{{ keyword }}</span>
    </div>
    <CardView :card="card" />
  </div>
</template>
