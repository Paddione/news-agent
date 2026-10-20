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
  [...(stats.value?.hfs.bySource ?? [])]
    .sort((a, b) => b.signal - b.hype - (a.signal - a.hype))
    .slice(0, 12),
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
        <button
          v-for="d in [1, 7, 30]"
          :key="d"
          class="bar-button"
          :data-days="d"
          :aria-pressed="days === d"
          @click="days = d"
        >
          {{ d }}d
        </button>
      </div>
      <button class="icon-button" aria-label="Close the dashboard" @click="go('/')">
        <X :size="18" />
      </button>
    </header>
    <div class="dashboard-grid">
      <article class="dash-tile" data-tile="topics">
        <h3>Topics by day</h3>
        <Heatmap
          v-if="topicCells.length"
          :rows="topicRows"
          :cols="topicCols"
          :cells="topicCells"
          @select="openTopic"
        />
        <p v-else class="dash-empty">No data in this window</p>
      </article>
      <article class="dash-tile" data-tile="funnel">
        <h3>Sweep funnel</h3>
        <template v-if="stats?.funnel.sweeps.length">
          <Funnel :stages="funnel" />
          <p class="dash-note">
            Presented per gathered, per sweep <Sparkline :values="sweepShare" />
            <a
              v-for="s in stats.funnel.sweeps.slice(-5)"
              :key="s.id"
              :href="`#/executions/sweep/${s.id}`"
              >#{{ s.id }}</a
            >
          </p>
        </template>
        <p v-else class="dash-empty">No data in this window</p>
      </article>
      <article class="dash-tile" data-tile="hfs">
        <h3>Hype, Facts, Signal</h3>
        <template v-if="hfsX.length">
          <StackedLine :x="hfsX" :series="hfsSeries" />
          <table class="dash-table">
            <tr>
              <th>Source</th>
              <th>Signal</th>
              <th>Facts</th>
              <th>Hype</th>
              <th>n</th>
            </tr>
            <tr v-for="s in sources" :key="s.source">
              <td>{{ s.source }}</td>
              <td>{{ s.signal }}</td>
              <td>{{ s.facts }}</td>
              <td>{{ s.hype }}</td>
              <td>{{ s.n }}</td>
            </tr>
          </table>
        </template>
        <p v-else class="dash-empty">No data in this window</p>
      </article>
      <article class="dash-tile" data-tile="feedback">
        <h3>Judge vs. your labels</h3>
        <template v-if="stats?.feedback.byJudge.length || moreLess.length">
          <p class="dash-kpi">
            Agreement
            <strong>{{
              stats?.feedback.agreement === null ? "n/a" : share(stats!.feedback.agreement!, 1)
            }}</strong>
          </p>
          <table v-if="stats?.feedback.byJudge.length" class="dash-table">
            <tr>
              <th>Judge</th>
              <th>n</th>
              <th>you: hype</th>
              <th>facts</th>
              <th>signal</th>
              <th>hit rate</th>
            </tr>
            <tr v-for="j in stats!.feedback.byJudge" :key="j.judge">
              <td :class="j.judge">{{ j.judge }}</td>
              <td>{{ j.n }}</td>
              <td>{{ j.humanHype }}</td>
              <td>{{ j.humanFacts }}</td>
              <td>{{ j.humanSignal }}</td>
              <td>{{ share(j.hits, j.n) }}</td>
            </tr>
          </table>
          <BarChart v-if="moreLess.length" :rows="moreLess" />
        </template>
        <p v-else class="dash-empty">No data in this window</p>
      </article>
    </div>
  </section>
</template>
