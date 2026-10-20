<script setup lang="ts">
// Topics in Settings, under one header per topic group. A group's weight multiplies its topics' weights; feedback
// never moves it. Topics without a group come last.
import { computed, ref } from "vue";
import { Plus, Power } from "@lucide/vue";
import type { Keyword, TopicGroup } from "@dna/sdk";
import { api, attempt } from "../client/store";
import KeywordRow from "./KeywordRow.vue";

const props = defineProps<{ topics: Keyword[]; groups: TopicGroup[] }>();
const emit = defineEmits<{ changed: [] }>();
const draft = ref("");

const sections = computed(() => [
  ...props.groups.map((g) => ({
    group: g,
    topics: props.topics.filter((k) => k.groupId === g.id),
  })),
  { group: undefined, topics: props.topics.filter((k) => k.groupId === undefined) },
]);

async function changed<T>(call: () => Promise<T>) {
  if (await attempt(call)) emit("changed");
}
async function addGroup() {
  const name = draft.value.trim().toLowerCase();
  if (!name) return;
  if (await attempt(() => api.addTopicGroup({ name }))) {
    draft.value = "";
    emit("changed");
  }
}
const updateGroup = (g: TopicGroup, patch: { weight?: number; enabled?: boolean }) =>
  changed(() => api.updateTopicGroup(g.id, patch));
const updateTopic = (
  k: Keyword,
  patch: { weight?: number; enabled?: boolean; groupId?: number | null },
) => changed(() => api.updateKeyword(k.id, patch));
const removeTopic = (k: Keyword) => changed(() => api.removeKeyword(k.id));
const effective = (k: Keyword, g?: TopicGroup) => (k.weight * (g?.weight ?? 1)).toFixed(2);
</script>

<template>
  <div
    v-for="s in sections"
    :key="s.group?.id ?? 'none'"
    class="kw-group-section"
    :class="{ off: s.group && !s.group.enabled }"
    :data-group="s.group?.name ?? ''"
  >
    <h4 class="kw-group-head">
      <span>{{ s.group?.name ?? "No group" }}</span>
      <template v-if="s.group">
        <input
          type="range"
          min="0.1"
          max="2"
          step="0.1"
          :value="s.group.weight"
          :aria-label="`Weight of the ${s.group.name} group`"
          title="Multiplies the weight of every topic in the group"
          @change="
            updateGroup(s.group, { weight: Number(($event.target as HTMLInputElement).value) })
          "
        />
        <span class="mono kw-weight">x{{ s.group.weight.toFixed(2) }}</span>
        <button
          class="icon-button small"
          :aria-label="`${s.group.enabled ? 'Turn off' : 'Turn on'} the ${s.group.name} group`"
          :aria-pressed="s.group.enabled"
          @click="updateGroup(s.group, { enabled: !s.group.enabled })"
        >
          <Power :size="13" />
        </button>
      </template>
    </h4>
    <KeywordRow
      v-for="k in s.topics"
      :key="k.id"
      :k="k"
      :groups="groups"
      :title="s.group ? `Effective weight ${effective(k, s.group)}` : undefined"
      @update="(patch) => updateTopic(k, patch)"
      @remove="removeTopic(k)"
    />
  </div>
  <form class="kw-add" @submit.prevent="addGroup">
    <input
      v-model="draft"
      aria-label="Add a topic group"
      placeholder="Add a group, like agent-ops"
    />
    <button class="icon-button small" type="submit" aria-label="Add topic group">
      <Plus :size="14" />
    </button>
  </form>
</template>
