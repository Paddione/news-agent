<script setup lang="ts">
// Turn a card into a GitHub issue in the inbox repo, with an optional note on what to check. Once it has one, the
// button becomes a chip that opens the issue.
import { nextTick, ref } from "vue";
import { CircleDot } from "@lucide/vue";
import type { Card } from "@dna/sdk";
import { api, attempt } from "../client/store";

const props = defineProps<{ card: Card }>();
const open = ref(false);
const note = ref("");
const busy = ref(false);
const field = ref<HTMLTextAreaElement>();

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
    :href="card.issue.url"
    target="_blank"
    rel="noopener"
    :aria-label="`Open issue #${card.issue.number}`"
    :title="`Issue #${card.issue.number}`"
    ><CircleDot :size="13" /><span>#{{ card.issue.number }}</span></a
  >
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
