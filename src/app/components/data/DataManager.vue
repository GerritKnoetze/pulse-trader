<script setup lang="ts">
import { computed } from 'vue'
import {
  Squares2X2Icon,
  CpuChipIcon,
  CircleStackIcon,
  CloudArrowUpIcon,
  SignalIcon,
} from '@heroicons/vue/24/outline'
import { useDataManager, type DataTab } from '~/composables/useDataManager'
import DataOverview from './DataOverview.vue'
import DataCachePanel from './DataCachePanel.vue'
import DataDbPanel from './DataDbPanel.vue'
import DataUpstreamPanel from './DataUpstreamPanel.vue'
import DataLivePanel from './DataLivePanel.vue'

const { activeTab } = useDataManager()

const tabs: { id: DataTab; label: string; icon: any; hint: string }[] = [
  { id: 'overview', label: 'Overview', icon: Squares2X2Icon, hint: 'Holistic view of every data store' },
  { id: 'cache', label: 'L1 · Cache', icon: CpuChipIcon, hint: 'In-memory caches (CandleCache, snapshot, rows, WS)' },
  { id: 'db', label: 'L2 · Database', icon: CircleStackIcon, hint: 'SQLite (MarketData, sync state, settings)' },
  { id: 'upstream', label: 'L3 · Upstream', icon: CloudArrowUpIcon, hint: 'Massive.com data provider (downloads, validation)' },
  { id: 'live', label: 'Live Activity', icon: SignalIcon, hint: 'Metrics counters + live app log' },
]

const currentHint = computed(() => tabs.find(t => t.id === activeTab.value)?.hint ?? '')
</script>

<template>
  <div class="data-manager">
    <div class="dm-header">
      <div>
        <h1 class="dm-title">Data Management</h1>
        <p class="dm-subtitle">{{ currentHint }}</p>
      </div>
    </div>

    <div class="dm-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        role="tab"
        class="dm-tab"
        :class="{ active: activeTab === tab.id }"
        :title="tab.hint"
        @click="activeTab = tab.id"
      >
        <component :is="tab.icon" class="btn-icon" />
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <div class="dm-content">
      <DataOverview v-show="activeTab === 'overview'" />
      <DataCachePanel v-show="activeTab === 'cache'" />
      <DataDbPanel v-show="activeTab === 'db'" />
      <DataUpstreamPanel v-show="activeTab === 'upstream'" />
      <DataLivePanel v-show="activeTab === 'live'" />
    </div>
  </div>
</template>

<style scoped>
.data-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--color-background);
}
.dm-header {
  padding: 1rem 1.25rem 0.5rem;
}
.dm-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
}
.dm-subtitle {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: var(--color-text-soft);
}
.dm-tabs {
  display: flex;
  gap: 0.35rem;
  padding: 0.5rem 1.25rem 0;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.dm-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  color: var(--color-text-soft);
  font-size: 0.82rem;
  font-weight: 500;
  padding: 0.55rem 0.9rem;
  cursor: pointer;
  margin-bottom: -1px;
  white-space: nowrap;
}
.dm-tab:hover { color: var(--color-text); background: var(--color-background-soft); }
.dm-tab.active {
  color: var(--color-primary);
  background: var(--color-background-soft);
  border-color: var(--color-border);
}
.dm-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1.25rem;
}
</style>
