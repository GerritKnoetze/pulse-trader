<script setup lang="ts">
import { computed } from 'vue'
import ScannerTabBar from '~/components/scanner/ScannerTabBar.vue'
import ScannerToolbar from '~/components/scanner/ScannerToolbar.vue'
import ScannerGrid from '~/components/scanner/ScannerGrid.vue'
import { useChartTabs } from '~/composables/useChartTabs'

definePageMeta({ layout: 'scanner' })
useHead({ title: 'Scanner — Pulse Trader' })

const { activeTab, tabs } = useChartTabs()
const activeTabData = computed(() => tabs.value.find(t => t.symbol === activeTab.value))
</script>

<template>
  <div class="scanner-page">
    <ScannerTabBar />

    <!-- Scan view -->
    <template v-if="activeTab === 'scan'">
      <ScannerToolbar />
      <ScannerGrid />
    </template>

    <!-- Symbol chart view (client-only: lightweight-charts is browser-only) -->
    <ClientOnly v-else-if="activeTabData">
      <ScannerSymbolChart
        :symbol="activeTabData.symbol"
        :base-price="activeTabData.basePrice"
      />
    </ClientOnly>
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
</style>
