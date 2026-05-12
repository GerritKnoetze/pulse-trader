<script setup lang="ts">
import ScannerTabBar from '~/components/scanner/ScannerTabBar.vue'
import ScannerGrid from '~/components/scanner/ScannerGrid.vue'
import { useChartTabs } from '~/composables/useChartTabs'

definePageMeta({ layout: 'scanner', ssr: false })
useHead({ title: 'Scanner — Pulse Trader' })

const { activeTab, tabs } = useChartTabs()
</script>

<template>
  <div class="scanner-page">
    <ScannerTabBar />

    <div class="scanner-view-area">
      <!-- Scan view — always mounted so SSE and row cache are never torn down -->
      <ScannerGrid v-show="activeTab === 'scan'" class="scanner-view-panel" />

      <!-- Symbol chart views — one per open tab, hidden when not active -->
      <template v-for="tab in tabs" :key="tab.symbol">
        <ScannerSymbolChart
          v-show="activeTab === tab.symbol"
          class="scanner-view-panel"
          :symbol="tab.symbol"
          :base-price="tab.basePrice"
          :setup="tab.setup"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.scanner-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--color-background);
}

/* Stacking context: all panels sit at the same position, each fills the area */
.scanner-view-area {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.scanner-view-panel {
  position: absolute;
  inset: 0;
}
</style>
