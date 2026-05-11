<script setup lang="ts">
import { computed } from 'vue'
import ScannerTabBar from '~/components/scanner/ScannerTabBar.vue'
import ScannerGrid from '~/components/scanner/ScannerGrid.vue'
import { useChartTabs } from '~/composables/useChartTabs'

definePageMeta({ layout: 'scanner', ssr: false })
useHead({ title: 'Scanner — Pulse Trader' })

const { activeTab, tabs } = useChartTabs()
const activeTabData = computed(() => tabs.value.find(t => t.symbol === activeTab.value))
</script>

<template>
  <div class="scanner-page">
    <ScannerTabBar />

    <!-- Scan view -->
    <template v-if="activeTab === 'scan'">
      <ScannerGrid />
    </template>

    <!-- Symbol chart view (client-only: lightweight-charts is browser-only) -->
    <ClientOnly v-else-if="activeTabData">
      <ScannerSymbolChart
        :symbol="activeTabData.symbol"
        :base-price="activeTabData.basePrice"
        :setup="activeTabData.setup"
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
