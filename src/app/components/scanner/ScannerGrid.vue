<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useScanner } from '~/composables/useScanner'
import { useGridColumns } from '~/composables/useGridColumns'
import { useGridFilters } from '~/composables/useGridFilters'
import { useGridLayouts } from '~/composables/useGridLayouts'
import { useGridFilterPresets } from '~/composables/useGridFilterPresets'
import ScannerLogConsole from '~/components/scanner/ScannerLogConsole.vue'
import ScannerSetupsPanel from '~/components/scanner/ScannerSetupsPanel.vue'
import ScannerAlertsDrawer from '~/components/scanner/ScannerAlertsDrawer.vue'

const { clearFilters, initScanner, runScan, connectLive, disconnectLive } = useScanner()
const { initColumns, resetColumns } = useGridColumns()
const { initFilters, resetFilters, closeFilterDropdown } = useGridFilters()
const { initLayouts } = useGridLayouts()
const { initPresets } = useGridFilterPresets()

const activePanel = ref<'columns' | 'layouts' | 'my-filters' | 'criteria' | 'setups' | 'alerts' | null>(null)
const logOpen = ref(false)

function togglePanel(p: 'columns' | 'layouts' | 'my-filters' | 'criteria' | 'setups' | 'alerts') {
  activePanel.value = activePanel.value === p ? null : p
}

function handleReset() {
  resetColumns()
  resetFilters()
  clearFilters()
}

function onDocClick() { closeFilterDropdown() }

onMounted(async () => {
  document.addEventListener('click', onDocClick)
  initScanner()
  initColumns()
  initFilters()
  initLayouts()
  initPresets()
  connectLive()
  // Auto-run initial scan
  await runScan(false)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  disconnectLive()
})
</script>

<template>
  <div class="scanner-grid-root">
    <div class="scanner-grid-wrapper">
      <div class="scanner-grid-main">
        <ScannerToolbar />
        <ScannerGridTable />
        <ScannerStatusBar :log-open="logOpen" @toggle-log="logOpen = !logOpen" />
        <ScannerLogConsole :open="logOpen" @update:open="logOpen = $event" />
      </div>
      <ScannerCriteriaPanel :open="activePanel === 'criteria'" @close="activePanel = null" />
      <ScannerColumnsDrawer :open="activePanel === 'columns'" @close="activePanel = null" />
      <ScannerLayoutsDrawer :open="activePanel === 'layouts'" @close="activePanel = null" @reset="handleReset" />
      <ScannerMyFiltersDrawer :open="activePanel === 'my-filters'" @close="activePanel = null" />
      <ScannerSetupsPanel :open="activePanel === 'setups'" @close="activePanel = null" />
      <ScannerAlertsDrawer :open="activePanel === 'alerts'" @close="activePanel = null" />
      <ScannerSideStrip
        :active-panel="activePanel"
        @toggle-panel="togglePanel"
      />
    </div>
    <ScannerColFilterDropdown />
  </div>
</template>

<style scoped>
/* Must NOT be display:contents — that removes the element's box and prevents
   position:absolute + inset:0 (applied via scanner-view-panel from scanner.vue)
   from establishing a definite size, which breaks the entire height chain:
   drawers lose their constrained height (no scrollbars, footer buttons disappear),
   scanner-grid-scroll collapses to zero height (loading overlay invisible). */
.scanner-grid-root {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.scanner-grid-wrapper {
  display: flex;
  flex-direction: row;
  flex: 1;
  overflow: hidden;
}

.scanner-grid-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}
</style>


