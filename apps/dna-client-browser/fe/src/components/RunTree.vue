<script setup lang="ts">
// A run as a tree: each generation with its model, tokens, cost, context and duration, and under it the tool
// calls it asked for. Compactions and retries show inline. Subagent runs nest under their tool call.
import { computed, onMounted, ref, watch } from "vue";
import { ChevronDown, ChevronRight, RotateCcw } from "@lucide/vue";
import { k, ms, usd, type RunDetail } from "@dna/sdk";
import { api, attempt } from "../client/store";
import { clean } from "../client/text";
import CopyJson from "./CopyJson.vue";
import ToolDetail from "./ToolDetail.vue";
import LoadingRows from "./LoadingRows.vue";

const props = defineProps<{ id: number; depth?: number; focusTool?: number }>();
const run = ref<RunDetail>();
const open = ref(new Set<number>());
const load = async () => {
  run.value = await attempt(() => api.run(props.id));
  if (props.focusTool) open.value = new Set([props.focusTool]);
};
onMounted(load);
watch(() => props.id, load);
const toggle = (id: number) => {
  const next = new Set(open.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  open.value = next;
};
// Compactions, plus retries: a generation task that sent more than one request attempt.
const marks = computed(() => {
  const events = run.value?.events ?? [];
  const seen = new Map<number, number>();
  return events
    .filter((e) => {
      if (e.event.startsWith("compaction")) return true;
      if (e.event !== "generation.request" || e.taskId === undefined) return false;
      const n = (seen.get(e.taskId) ?? 0) + 1;
      seen.set(e.taskId, n);
      return n > 1;
    })
    .map((e) => ({
      ...e,
      event: e.event === "generation.request" ? `retry of generation task ${e.taskId}` : e.event,
    }));
});
</script>

<template>
  <div v-if="run" class="run-tree" :class="`depth-${depth ?? 0}`" :data-run="run.runEntryId">
    <div class="node-head">
      <strong>{{ run.agent }}</strong>
      <span class="status" :class="run.status">{{ run.status }}</span>
      <span>{{ run.generations }} generations</span><span>{{ run.toolCalls }} tool calls</span>
      <span>{{ k(run.tokensIn) }} in</span><span>{{ k(run.tokensOut) }} out</span
      ><span>{{ usd(run.costUsd) }}</span>
      <span>{{ ms(run.endedAt ? run.endedAt - run.startedAt : undefined) }}</span>
      <span class="grow" />
      <CopyJson :value="run" label="run" />
    </div>
    <div v-for="e in marks" :key="e.id" class="event-line">
      <RotateCcw :size="13" />{{ e.event }} {{ e.data ? JSON.stringify(e.data).slice(0, 120) : "" }}
    </div>
    <div
      v-for="g in run.generationRows"
      :key="g.entryId"
      class="generation"
      :data-generation="g.entryId"
    >
      <div class="gen-head">
        <span class="mono">{{ g.model }}</span>
        <span>{{ k(g.inputTokens) }} in</span><span>{{ k(g.outputTokens) }} out</span
        ><span>{{ k(g.cacheReadTokens) }} cached</span> <span>{{ usd(g.costUsd) }}</span
        ><span>{{ k(g.contextTokens) }} ctx</span><span>{{ ms(g.durationMs) }}</span>
        <span v-if="g.thinkingChars">{{ k(g.thinkingChars) }} thinking chars</span>
        <span v-if="g.error" class="bad">{{ clean(g.error) }}</span>
        <span class="grow" /><CopyJson :value="g" label="generation" />
      </div>
      <p v-if="g.text" class="gen-text">{{ clean(g.text).slice(0, 400) }}</p>
      <div
        v-for="t in run.toolCallRows.filter((t) => t.generationEntryId === g.entryId)"
        :key="t.id"
        class="tool-node"
      >
        <button
          class="tool-node-head"
          :class="{ bad: t.isError }"
          :aria-expanded="open.has(t.id)"
          :data-tool-row="t.id"
          @click="toggle(t.id)"
        >
          <ChevronDown v-if="open.has(t.id)" :size="13" /><ChevronRight v-else :size="13" />
          <span class="mono">{{ t.toolName }}</span><span>{{ t.isError ? "error" : t.status }}</span
          ><span>{{ ms(t.durationMs) }}</span>
          <span v-if="t.children?.length">{{ t.children.length }} subagents</span>
        </button>
        <ToolDetail v-if="open.has(t.id)" :id="t.id" :depth="depth ?? 0" />
      </div>
    </div>
  </div>
  <LoadingRows v-else kind="lines" :count="5" label="Loading the run" />
</template>
