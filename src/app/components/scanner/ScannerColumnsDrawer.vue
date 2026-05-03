<script setup lang="ts">
import { ViewColumnsIcon } from '@heroicons/vue/24/outline'
import { useGridColumns } from '~/composables/useGridColumns'

defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const { COLUMNS, hiddenCols, toggleColVisibility } = useGridColumns()
</script>

<template>
  <div class="side-drawer" :class="{ open }">
    <div class="drawer-header">
      <div class="drawer-header-left">
        <ViewColumnsIcon class="drawer-header-icon" />
        <span class="drawer-title">Columns</span>
      </div>
      <button class="drawer-close-btn" @click="$emit('close')">✕</button>
    </div>
    <div class="drawer-section drawer-section-scroll">
      <div class="drawer-section-label">Toggle Columns</div>
      <label
        v-for="col in COLUMNS"
        :key="col.key"
        class="col-toggle-row"
        :class="{ hidden: hiddenCols.has(col.key as string) }"
      >
        <input
          type="checkbox"
          :checked="!hiddenCols.has(col.key as string)"
          @change="toggleColVisibility(col.key as string)"
        />
        <span class="col-toggle-label">{{ col.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.side-drawer {
  width: 0;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #161616;
  border-left: 1px solid transparent;
  transition: width 0.22s ease, border-color 0.22s ease;
}

.side-drawer.open {
  width: 260px;
  border-left-color: var(--color-border);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.drawer-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: #ddd;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.drawer-close-btn {
  background: none;
  border: none;
  color: #666;
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.15rem 0.3rem;
  border-radius: 3px;
  transition: color 0.1s;
  line-height: 1;
}

.drawer-close-btn:hover { color: #ccc; }

.drawer-header-icon {
  width: 14px;
  height: 14px;
  color: #c87628;
  flex-shrink: 0;
}

.drawer-header-left {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.drawer-section {
  padding: 0.65rem 0.75rem;
  flex-shrink: 0;
}

.drawer-section-scroll {
  flex: 1;
  overflow-y: auto;
  flex-shrink: 1;
}

.drawer-section-scroll::-webkit-scrollbar { width: 4px; }
.drawer-section-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

.drawer-section-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.5rem;
}

.col-toggle-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.35rem 0.2rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s;
}

.col-toggle-row:hover {
  background: rgba(255,255,255,0.05);
}

.col-toggle-row input[type="checkbox"] {
  accent-color: #c87628;
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  cursor: pointer;
}

.col-toggle-label {
  font-size: 0.82rem;
  color: #ccc;
}

.col-toggle-row.hidden .col-toggle-label {
  color: #555;
}
</style>
