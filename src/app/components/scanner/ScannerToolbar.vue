<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronDownIcon, XMarkIcon, FunnelIcon } from '@heroicons/vue/24/outline'
import { useScanner } from '~/composables/useScanner'
import { useGridFilterPresets } from '~/composables/useGridFilterPresets'
import { useGridFilters } from '~/composables/useGridFilters'
import type { ScannerTimeframe, ScannerMode } from '~/types/scanner'

const {
  timeframe, mode, activeQuickFilter,
  setTimeframe, setMode, toggleQuickFilter, clearFilters,
  QUICK_FILTERS,
} = useScanner()

const { savedPresets, applyPreset } = useGridFilterPresets()
const { resetFilters } = useGridFilters()

const TIMEFRAMES: ScannerTimeframe[] = ['15', '30', '60', 'D', 'W', 'M', 'Q', 'Y']

const quickFiltersOpen = ref(false)
const gridOptionsOpen = ref(false)
const activePresetName = ref<string | null>(null)

const activeFilterLabel = computed(() => {
  if (activePresetName.value) return activePresetName.value
  if (!activeQuickFilter.value) return null
  return QUICK_FILTERS.find(f => f.id === activeQuickFilter.value)?.label ?? null
})

function selectFilter(id: string) {
  activePresetName.value = null
  resetFilters()
  toggleQuickFilter(id)
  quickFiltersOpen.value = false
}

function selectPreset(id: string) {
  const preset = savedPresets.value.find(p => p.id === id)
  if (!preset) return
  applyPreset(preset)
  activePresetName.value = preset.name
  quickFiltersOpen.value = false
}
</script>

<template>
  <div class="scanner-toolbar">
    <!-- Time frame buttons -->
    <div class="tf-group">
      <button
        v-for="tf in TIMEFRAMES"
        :key="tf"
        class="tf-btn"
        :class="{ active: tf === timeframe }"
        @click="setTimeframe(tf)"
      >
        {{ tf }}
      </button>
    </div>

    <div class="toolbar-divider" />

    <!-- Scan mode -->
    <div class="scan-mode-group">
      <span class="scan-mode-label">Scan Mode</span>
      <div class="mode-toggle">
        <button
          class="mode-btn"
          :class="{ active: mode === 'signal' }"
          @click="setMode('signal')"
        >
          <span v-if="mode === 'signal'" class="mode-indicator" />
          Signal
        </button>
        <button
          class="mode-btn"
          :class="{ active: mode === 'setup' }"
          @click="setMode('setup')"
        >
          <span v-if="mode === 'setup'" class="mode-indicator" />
          Setup
        </button>
      </div>
    </div>

    <div class="toolbar-divider" />

    <!-- Quick Filters (split button: trigger + inline clear) -->
    <div
      class="quick-filters-wrap"
      @mouseenter="quickFiltersOpen = true"
      @mouseleave="quickFiltersOpen = false"
    >
      <div class="quick-filters-btn" :class="{ 'has-active': activeQuickFilter }">
        <button class="qf-trigger" @click.stop>
          <FunnelIcon class="btn-icon" />
          <span>{{ activeFilterLabel ?? 'Quick Filters' }}</span>
          <ChevronDownIcon class="btn-chevron" :class="{ rotated: quickFiltersOpen }" />
        </button>
        <span v-show="activeQuickFilter || activePresetName" class="qf-divider" />
        <button
          v-show="activeQuickFilter || activePresetName"
          class="qf-clear"
          title="Clear filter"
          @click.stop="clearFilters(); resetFilters(); activePresetName = null"
        >
          <XMarkIcon class="btn-icon" />
        </button>
      </div>
      <div v-if="quickFiltersOpen" class="quick-filters-menu">
        <button
          v-for="filter in QUICK_FILTERS"
          :key="filter.id"
          class="qf-item"
          :class="{ active: activeQuickFilter === filter.id && !activePresetName }"
          @click="selectFilter(filter.id)"
        >
          {{ filter.label }}
        </button>
        <template v-if="savedPresets.length > 0">
          <div class="qf-divider-row">
            <span class="qf-divider-label">My Filters</span>
          </div>
          <button
            v-for="preset in savedPresets"
            :key="preset.id"
            class="qf-item qf-item-preset"
            :class="{ active: activePresetName === preset.name }"
            @click="selectPreset(preset.id)"
          >
            {{ preset.name }}
          </button>
        </template>
      </div>
    </div>

    <!-- Spacer -->
    <div class="toolbar-spacer" />

    <!-- Grid Options -->
    <div
      class="grid-options-wrap"
      @mouseenter="gridOptionsOpen = true"
      @mouseleave="gridOptionsOpen = false"
    >
      <button class="grid-options-btn">
        Grid Options
        <ChevronDownIcon class="btn-chevron" :class="{ rotated: gridOptionsOpen }" />
      </button>
      <div v-if="gridOptionsOpen" class="grid-options-menu">
        <button class="qf-item">Two Bar Display</button>
        <button class="qf-item">Auto Size Columns</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scanner-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.75rem;
  height: 2.5rem;
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  flex-wrap: nowrap;
  /* Do NOT use overflow-x: auto — it creates a clipping context that hides dropdowns */
  position: relative;
  z-index: 100;
}

/* Time frames */
.tf-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tf-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.3rem 0.55rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  letter-spacing: 0.02em;
}

.tf-btn:hover {
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.07);
}

.tf-btn.active {
  background: #c87628;
  color: #fff;
}

/* Divider */
.toolbar-divider {
  width: 1px;
  height: 1.4rem;
  background: var(--color-border);
  flex-shrink: 0;
}

/* Scan mode */
.scan-mode-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.scan-mode-label {
  font-size: 0.8rem;
  color: var(--color-text-soft);
  white-space: nowrap;
}

.mode-toggle {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 0.82rem;
  font-weight: 500;
  padding: 0.28rem 0.7rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-btn:hover {
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.05);
}

.mode-btn.active {
  color: #c87628;
}

.mode-indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #c87628;
  flex-shrink: 0;
}

/* Quick filters */
.quick-filters-wrap {
  position: relative;
}

.quick-filters-btn {
  display: flex;
  align-items: center;
  background: #c87628;
  border-radius: var(--radius-sm);
  overflow: hidden;
  transition: background 0.15s ease;
}

.quick-filters-btn:hover {
  background: #d9892e;
}

.quick-filters-btn.has-active {
  background: #a86520;
}

.qf-trigger {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.32rem 0.75rem;
  cursor: pointer;
  white-space: nowrap;
}

.qf-divider {
  width: 1px;
  align-self: stretch;
  background: rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

.qf-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  padding: 0.32rem 0.5rem;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
  flex-shrink: 0;
}

.qf-clear:hover {
  color: #fff;
  background: rgba(0, 0, 0, 0.2);
}

.quick-filters-menu {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 180px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.3rem;
  z-index: 200;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  /* Transparent top padding bridges the gap so mouse can move into the menu */
  padding-top: 0.3rem;
}

.quick-filters-menu::before {
  content: '';
  position: absolute;
  top: -8px;
  left: 0;
  right: 0;
  height: 8px;
}

.qf-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 0.83rem;
  padding: 0.45rem 0.65rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.12s ease;
}

.qf-item:hover {
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.07);
}

.qf-item.active {
  color: #c87628;
  background: rgba(200, 118, 40, 0.12);
}

.qf-divider-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.65rem 0.15rem;
  margin-top: 0.1rem;
  border-top: 1px solid var(--color-border);
}

.qf-divider-label {
  font-size: 0.68rem;
  font-weight: 700;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.qf-item-preset {
  font-style: italic;
  color: #999;
}

.toolbar-spacer {
  flex: 1;
}

/* Grid options */
.grid-options-wrap {
  position: relative;
}

.grid-options-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  font-size: 0.82rem;
  padding: 0.3rem 0.65rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.grid-options-btn:hover {
  color: var(--color-text);
  border-color: #555;
}

.grid-options-menu {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 170px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.3rem;
  z-index: 200;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.grid-options-menu::before {
  content: '';
  position: absolute;
  top: -8px;
  left: 0;
  right: 0;
  height: 8px;
}

.btn-icon {
  width: 0.9rem;
  height: 0.9rem;
  flex-shrink: 0;
}

.btn-chevron {
  width: 0.85rem;
  height: 0.85rem;
  transition: transform 0.15s ease;
  flex-shrink: 0;
}

.btn-chevron.rotated {
  transform: rotate(180deg);
}

/* Criteria button */
.criteria-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  font-size: 0.82rem;
  padding: 0.28rem 0.65rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  position: relative;
  white-space: nowrap;
}
.criteria-btn:hover { color: var(--color-text); border-color: #555; }

.criteria-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #c87628;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
}

/* Scan button */
.scan-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: #c87628;
  border: none;
  border-radius: var(--radius-sm);
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.3rem 0.75rem;
  cursor: pointer;
  white-space: nowrap;
  letter-spacing: 0.02em;
}
.scan-btn:hover:not(:disabled) { background: #d98a3a; }
.scan-btn:disabled { opacity: 0.6; cursor: default; }

.scan-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: toolbar-spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes toolbar-spin { to { transform: rotate(360deg); } }
</style>
