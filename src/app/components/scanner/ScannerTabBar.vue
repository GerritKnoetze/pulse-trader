<script setup lang="ts">
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useChartTabs } from '~/composables/useChartTabs'

const { tabs, activeTab, setActiveTab, closeTab, isTabLoading } = useChartTabs()
</script>

<template>
  <div class="scanner-tab-bar">
    <!-- Scan tab (always first) -->
    <button
      class="tab"
      :class="{ active: activeTab === 'scan' }"
      @click="setActiveTab('scan')"
    >
      <MagnifyingGlassIcon class="tab-icon" />
      <span class="tab-label">Scan</span>
    </button>

    <!-- Symbol tabs -->
    <button
      v-for="tab in tabs"
      :key="tab.symbol"
      class="tab tab-symbol"
      :class="{ active: activeTab === tab.symbol }"
      @click="setActiveTab(tab.symbol)"
    >
      <span v-if="isTabLoading(tab.symbol)" class="tab-spinner" />
      <span class="tab-label">{{ tab.symbol }}</span>
      <span class="tab-close" @click.stop="closeTab(tab.symbol)">
        <XMarkIcon class="tab-close-icon" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.scanner-tab-bar {
  display: flex;
  align-items: stretch;
  height: 2.1rem;
  background: var(--color-background-mute);
  border-bottom: 1px solid var(--color-border);
  overflow-x: auto;
  overflow-y: hidden;
  flex-shrink: 0;
}

.scanner-tab-bar::-webkit-scrollbar {
  height: 2px;
}
.scanner-tab-bar::-webkit-scrollbar-thumb {
  background: var(--color-border);
}

.tab {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0 0.85rem;
  background: none;
  border: none;
  border-right: 1px solid var(--color-border);
  color: #7a7a7a;
  cursor: pointer;
  font-size: 0.81rem;
  font-weight: 500;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
  position: relative;
}

.tab:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text);
}

.tab.active {
  background: var(--color-background);
  color: var(--color-text);
}

/* orange underline for active tab */
.tab.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: #c87628;
}

.tab-icon {
  width: 0.85rem;
  height: 0.85rem;
  flex-shrink: 0;
}

.tab-label {
  font-size: 0.81rem;
}

/* ── Tab loading spinner ─────────────────────────────────── */
.tab-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid rgba(200, 118, 40, 0.25);
  border-top-color: #c87628;
  border-radius: 50%;
  animation: tab-spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes tab-spin { to { transform: rotate(360deg); } }

.tab-symbol {
  min-width: 5rem;
  justify-content: space-between;
  padding-right: 0.3rem;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  border-radius: 3px;
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0.4;
  transition: opacity 0.1s, background 0.1s;
}

.tab-close:hover {
  background: rgba(255, 255, 255, 0.15);
  opacity: 1;
}

.tab-close-icon {
  width: 0.68rem;
  height: 0.68rem;
}
</style>
