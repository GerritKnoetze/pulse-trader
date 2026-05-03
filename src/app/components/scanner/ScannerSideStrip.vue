<script setup lang="ts">
import {
  ViewColumnsIcon,
  CircleStackIcon,
  FunnelIcon,
} from '@heroicons/vue/24/outline'

const props = defineProps<{
  activePanel: 'columns' | 'layouts' | 'my-filters' | null
}>()

defineEmits<{
  togglePanel: ['columns' | 'layouts' | 'my-filters']
}>()
</script>

<template>
  <div class="scanner-side-strip">
    <button
      class="side-strip-btn"
      :class="{ active: props.activePanel === 'columns' }"
      title="Columns"
      @click="$emit('togglePanel', 'columns')"
    >
      <ViewColumnsIcon class="strip-icon" />
      <span class="strip-label">Columns</span>
    </button>
    <button
      class="side-strip-btn"
      :class="{ active: props.activePanel === 'layouts' }"
      title="Layouts"
      @click="$emit('togglePanel', 'layouts')"
    >
      <CircleStackIcon class="strip-icon" />
      <span class="strip-label">Layouts</span>
    </button>
    <button
      class="side-strip-btn"
      :class="{ active: props.activePanel === 'my-filters' }"
      title="My Filters"
      @click="$emit('togglePanel', 'my-filters')"
    >
      <FunnelIcon class="strip-icon" />
      <span class="strip-label">My Filters</span>
    </button>
  </div>
</template>

<style scoped>
.scanner-side-strip {
  width: 28px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-background-mute);
  border-left: 1px solid var(--color-border);
}

.side-strip-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0.65rem 0.2rem;
  transition: all 0.15s ease;
  height: 80px;
}

.side-strip-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text);
}

.side-strip-btn.active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.strip-icon {
  width: 0.9rem;
  height: 0.9rem;
  flex-shrink: 0;
}

.strip-label {
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
  writing-mode: vertical-lr;
}
</style>
