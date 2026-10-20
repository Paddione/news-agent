<script setup lang="ts">
// One keyword in Settings: term, weight slider, on/off and remove; topics also pick their group.
import { Power, Trash2 } from "@lucide/vue";
import type { Keyword, TopicGroup } from "@dna/sdk";

defineProps<{ k: Keyword; groups?: TopicGroup[] }>();
const emit = defineEmits<{
  update: [patch: { weight?: number; enabled?: boolean; groupId?: number | null }];
  remove: [];
}>();
const groupOf = (value: string) => (value ? Number(value) : null);
</script>

<template>
  <div class="kw-row" :class="{ off: !k.enabled }" :data-keyword="k.term">
    <span class="kw-term">{{ k.term }}</span>
    <select
      v-if="groups"
      class="kw-group"
      :value="k.groupId ?? ''"
      :aria-label="`Group of ${k.term}`"
      @change="emit('update', { groupId: groupOf(($event.target as HTMLSelectElement).value) })"
    >
      <option value="">No group</option>
      <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
    </select>
    <input
      type="range"
      min="0.1"
      max="2"
      step="0.05"
      :value="k.weight"
      :aria-label="`Weight of ${k.term}`"
      @change="emit('update', { weight: Number(($event.target as HTMLInputElement).value) })"
    />
    <span class="mono kw-weight">{{ k.weight.toFixed(2) }}</span>
    <button
      class="icon-button small"
      :aria-label="`${k.enabled ? 'Turn off' : 'Turn on'} ${k.term}`"
      :aria-pressed="k.enabled"
      @click="emit('update', { enabled: !k.enabled })"
    >
      <Power :size="13" />
    </button>
    <button class="icon-button small" :aria-label="`Remove ${k.term}`" @click="emit('remove')">
      <Trash2 :size="13" />
    </button>
  </div>
</template>
