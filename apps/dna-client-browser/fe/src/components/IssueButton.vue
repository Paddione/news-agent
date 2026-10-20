<script setup lang="ts">
// Turn a card into a GitHub issue in the inbox repo, with an optional note on what to check. Once it has one, the
// button becomes a chip that opens the issue.
import { computed, nextTick, ref } from "vue";
import { AlertTriangle, Check, CircleDot, Clock, Loader2 } from "@lucide/vue";
import type { Card } from "@dna/sdk";
import { api, attempt } from "../client/store";

const props = defineProps<{ card: Card }>();
const open = ref(false);
const note = ref("");
const busy = ref(false);
const field = ref<HTMLTextAreaElement>();

const investigation = computed(() => props.card.issue?.investigation);

const stateText = computed(() => {
  const s = investigation.value?.status;
  if (!s) return "";
  if (s === "done") return "investigated";
  if (s === "running") return "running";
  return s; // "queued", "failed"
});

const chipLabel = computed(() => {
  if (!props.card.issue) return "";
  return stateText.value
    ? `Open issue #${props.card.issue.number}, ${stateText.value}`
    : `Open issue #${props.card.issue.number}`;
});

const chipTitle = computed(() => {
  if (!props.card.issue) return "";
  return stateText.value
    ? `Issue #${props.card.issue.number} (${stateText.value})`
    : `Issue #${props.card.issue.number}`;
});

function shortTarget(target: string): string {
  if (target === "home-patrick") return "dotfiles";
  if (target.startsWith("home-patrick-")) return target.slice("home-patrick-".length);
  return target;
}

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    field.value?.focus();
  }
}
async function create() {
  busy.value = true;
  const note_ = note.value.trim();
  const issue = await attempt(() => api.createIssue(props.card.id, note_ ? { note: note_ } : {}));
  busy.value = false;
  if (issue) {
    open.value = false;
    note.value = "";
  }
}
</script>

<template>
  <a
    v-if="card.issue"
    class="timeline-chip issue-chip"
    :class="investigation ? `status-${investigation.status}` : ''"
    :href="card.issue.url"
    target="_blank"
    rel="noopener"
    :aria-label="chipLabel"
    :title="chipTitle"
  >
    <Clock v-if="investigation?.status === 'queued'" :size="13" />
    <Loader2 v-else-if="investigation?.status === 'running'" :size="13" class="spin" />
    <Check v-else-if="investigation?.status === 'done'" :size="13" />
    <AlertTriangle v-else-if="investigation?.status === 'failed'" :size="13" />
    <CircleDot v-else :size="13" />
    <span>#{{ card.issue.number }}</span>
    <template v-if="investigation?.status === 'done' && investigation.targets?.length">
      <span
        v-for="target in investigation.targets"
        :key="target"
        class="target-tag"
      >{{ shortTarget(target) }}</span>
    </template>
  </a>
  <button
    v-else
    class="icon-button small"
    data-cap="card.issue"
    aria-label="Create issue"
    title="Turn this card into a GitHub issue"
    :aria-expanded="open"
    :disabled="busy"
    @click="toggle"
  >
    <CircleDot :size="14" />
  </button>
  <form
    v-if="open && !card.issue"
    class="issue-panel"
    @submit.prevent="create"
    @keydown.escape.stop="open = false"
  >
    <textarea
      ref="field"
      v-model="note"
      rows="3"
      maxlength="2000"
      aria-label="What should be checked? (optional)"
      placeholder="What should be checked? (optional)"
    />
    <div class="issue-actions">
      <button type="button" class="button secondary" @click="open = false">Cancel</button>
      <button type="submit" class="button" :disabled="busy" aria-label="Create the issue">
        Create issue
      </button>
    </div>
  </form>
</template>
