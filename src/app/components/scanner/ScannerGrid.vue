<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useScanner } from '~/composables/useScanner'
import { useGridColumns } from '~/composables/useGridColumns'
import { useGridFilters } from '~/composables/useGridFilters'
import { useGridLayouts } from '~/composables/useGridLayouts'
import { useGridFilterPresets } from '~/composables/useGridFilterPresets'

const { clearFilters, initScanner, runScan, connectLive, disconnectLive } = useScanner()
const { initColumns, resetColumns } = useGridColumns()
const { initFilters, resetFilters, closeFilterDropdown } = useGridFilters()
const { initLayouts } = useGridLayouts()
const { initPresets } = useGridFilterPresets()

const activePanel = ref<'columns' | 'layouts' | 'my-filters' | 'criteria' | null>(null)

function togglePanel(p: 'columns' | 'layouts' | 'my-filters' | 'criteria') {
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
  <div class="scanner-grid-wrapper">
    <div class="scanner-grid-main">
      <ScannerToolbar />
      <ScannerGridTable />
      <ScannerStatusBar />
    </div>
    <ScannerCriteriaPanel :open="activePanel === 'criteria'" @close="activePanel = null" />
    <ScannerColumnsDrawer :open="activePanel === 'columns'" @close="activePanel = null" />
    <ScannerLayoutsDrawer :open="activePanel === 'layouts'" @close="activePanel = null" @reset="handleReset" />
    <ScannerMyFiltersDrawer :open="activePanel === 'my-filters'" @close="activePanel = null" />
    <ScannerSideStrip
      :active-panel="activePanel"
      @toggle-panel="togglePanel"
    />
  </div>
  <ScannerColFilterDropdown />
</template>

<style scoped>
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


