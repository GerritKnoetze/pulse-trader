<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { MagnifyingGlassIcon, TrashIcon } from '@heroicons/vue/24/outline'
import ScannerSymbolSearch from '~/components/scanner/ScannerSymbolSearch.vue'
import { useChartSync } from '~/composables/useChartSync'
import { useDrawingTools } from '~/composables/useDrawingTools'

const { syncEnabled } = useChartSync()
const { activeTool, setActiveTool, selectedDrawingId, deleteSelected, magnetEnabled } = useDrawingTools()

const symbolSearchOpen = ref(false)
const ctrlActive       = ref(false)
const shiftActive      = ref(false)

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Control') ctrlActive.value = true
  if (e.key === 'Shift')   shiftActive.value = true
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    symbolSearchOpen.value = true
  }
  if (e.key === 'Delete' && selectedDrawingId.value !== null) {
    e.preventDefault()
    deleteSelected()
  }
}

function onGlobalKeyup(e: KeyboardEvent) {
  if (e.key === 'Control') ctrlActive.value = false
  if (e.key === 'Shift')   shiftActive.value = false
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('keyup', onGlobalKeyup)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('keyup', onGlobalKeyup)
})
</script>

<template>
  <div class="chart-toolbar">
    <!-- Symbol search button -->
    <button
      class="symbol-search-btn"
      title="Search symbol (Ctrl+K)"
      @click="symbolSearchOpen = true"
    >
      <MagnifyingGlassIcon class="btn-icon" />
    </button>

    <div class="toolbar-divider" />

    <!-- Crosshair sync toggle -->
    <button
      class="sync-btn"
      :class="{ active: syncEnabled }"
      title="Sync crosshair across all panels"
      @click="syncEnabled = !syncEnabled"
    >
      <!-- inline crosshair SVG -->
      <svg class="sync-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="7" y1="0" x2="7" y2="5" />
        <line x1="7" y1="9" x2="7" y2="14" />
        <line x1="0" y1="7" x2="5" y2="7" />
        <line x1="9" y1="7" x2="14" y2="7" />
        <circle cx="7" cy="7" r="2.2" />
      </svg>
    </button>

    <!-- Magnet snap toggle -->
    <button
      class="sync-btn magnet-btn"
      :class="{ active: magnetEnabled, 'ctrl-hint': ctrlActive && !magnetEnabled }"
      title="Snap crosshair to OHLC (hold Ctrl for temporary)"
      @click="magnetEnabled = !magnetEnabled"
    >
      <svg class="sync-icon" viewBox="0 0 14 19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt">
        <!-- White-filled pole areas (left and right) -->
        <rect x="1" y="15.25" width="4" height="3.25" fill="white" stroke="none" />
        <rect x="9" y="15.25" width="4" height="3.25" fill="white" stroke="none" />
        <!-- Outer horseshoe -->
        <path d="M 1 18.5 L 1 7 A 6 6 0 0 1 13 7 L 13 18.5" />
        <!-- Inner horseshoe -->
        <path d="M 5 18.5 L 5 7 A 2 2 0 0 1 9 7 L 9 18.5" />
        <!-- Left pole cap -->
        <line x1="1" y1="18.5" x2="5" y2="18.5" />
        <!-- Right pole cap -->
        <line x1="9" y1="18.5" x2="13" y2="18.5" />
      </svg>
    </button>

    <div class="toolbar-divider" />

    <!-- Drawing tools -->

    <!-- Trendline: diagonal, hollow dot at each end -->
    <button class="tool-btn" :class="{ active: activeTool === 'trendline' }" title="Trendline" @click="setActiveTool('trendline')">
      <svg class="tool-icon" viewBox="0 0 20 14" fill="none">
        <line x1="4" y1="11" x2="16" y2="3" stroke="currentColor" stroke-width="1.4" />
        <circle cx="3.5" cy="11.5" r="1.8" stroke="currentColor" stroke-width="1.4" />
        <circle cx="16.5" cy="2.5"  r="1.8" stroke="currentColor" stroke-width="1.4" />
      </svg>
    </button>

    <!-- Ray: two hollow dots, line between and extending past, gaps at circles -->
    <button class="tool-btn" :class="{ active: activeTool === 'ray' }" title="Ray" @click="setActiveTool('ray')">
      <svg class="tool-icon" viewBox="0 0 20 14" fill="none">
        <line x1="4.6" y1="10.2" x2="11.4" y2="6.8" stroke="currentColor" stroke-width="1.4" />
        <line x1="14.6" y1="5.2" x2="20"   y2="2.5" stroke="currentColor" stroke-width="1.4" />
        <circle cx="3"  cy="11" r="1.8" stroke="currentColor" stroke-width="1.4" />
        <circle cx="13" cy="6"  r="1.8" stroke="currentColor" stroke-width="1.4" />
      </svg>
    </button>

    <!-- Horizontal line: —○— hollow circle in the center -->
    <button class="tool-btn" :class="{ active: activeTool === 'horizontal-line' }" title="Horizontal Line" @click="setActiveTool('horizontal-line')">
      <svg class="tool-icon" viewBox="0 0 20 10" fill="none">
        <line x1="0"    y1="5" x2="7.5"  y2="5" stroke="currentColor" stroke-width="1.4" />
        <circle cx="10" cy="5" r="2.2" stroke="currentColor" stroke-width="1.4" />
        <line x1="12.5" y1="5" x2="20"   y2="5" stroke="currentColor" stroke-width="1.4" />
      </svg>
    </button>

    <!-- Horizontal ray: hollow dot at left, line to right -->
    <button class="tool-btn" :class="{ active: activeTool === 'horizontal-ray' }" title="Horizontal Ray" @click="setActiveTool('horizontal-ray')">
      <svg class="tool-icon" viewBox="0 0 20 10" fill="none">
        <circle cx="3" cy="5" r="2.2" stroke="currentColor" stroke-width="1.4" />
        <line x1="5.2" y1="5" x2="20" y2="5" stroke="currentColor" stroke-width="1.4" />
      </svg>
    </button>

    <!-- Vertical line: vertical line with hollow circle in the middle -->
    <button class="tool-btn" :class="{ active: activeTool === 'vertical-line' }" title="Vertical Line" @click="setActiveTool('vertical-line')">
      <svg class="tool-icon tool-icon--tall" viewBox="0 0 10 16" fill="none">
        <line x1="5" y1="0"  x2="5" y2="5.8"  stroke="currentColor" stroke-width="1.4" />
        <circle cx="5" cy="8" r="2.2" stroke="currentColor" stroke-width="1.4" />
        <line x1="5" y1="10.2" x2="5" y2="16" stroke="currentColor" stroke-width="1.4" />
      </svg>
    </button>

    <!-- Ruler -->
    <button class="tool-btn" :class="{ active: activeTool === 'ruler', 'ctrl-hint': shiftActive && activeTool !== 'ruler' }" title="Ruler (or hold Shift+click on chart)" @click="setActiveTool('ruler')">
      <svg class="tool-icon tool-icon--ruler" viewBox="0 0 28 14" fill="none">
        <!-- Ruler body -->
        <rect x="0.7" y="0.7" width="26.6" height="12.6" rx="1.3" stroke="currentColor" stroke-width="1.4" />
        <!-- Long ticks (every 4 units) -->
        <line x1="7"  y1="1.4" x2="7"  y2="7.5" stroke="currentColor" stroke-width="1.2" />
        <line x1="14" y1="1.4" x2="14" y2="9"   stroke="currentColor" stroke-width="1.2" />
        <line x1="21" y1="1.4" x2="21" y2="7.5" stroke="currentColor" stroke-width="1.2" />
        <!-- Short ticks -->
        <line x1="3.5"  y1="1.4" x2="3.5"  y2="5.5" stroke="currentColor" stroke-width="1.1" />
        <line x1="10.5" y1="1.4" x2="10.5" y2="5.5" stroke="currentColor" stroke-width="1.1" />
        <line x1="17.5" y1="1.4" x2="17.5" y2="5.5" stroke="currentColor" stroke-width="1.1" />
        <line x1="24.5" y1="1.4" x2="24.5" y2="5.5" stroke="currentColor" stroke-width="1.1" />
      </svg>
    </button>

    <template v-if="selectedDrawingId !== null">
      <button class="delete-btn" title="Delete selected drawing (Del)" @click="deleteSelected">
        <TrashIcon class="btn-icon" />
      </button>
    </template>

    <div class="toolbar-spacer" />
  </div>

  <ScannerSymbolSearch v-model:open="symbolSearchOpen" />
</template>

<style scoped>
.chart-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.75rem;
  height: 2.5rem;
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  flex-wrap: nowrap;
  position: relative;
  z-index: 100;
}

/* Symbol search button — matches ScannerToolbar exactly */
.symbol-search-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #c87628;
  border: none;
  color: #fff;
  padding: 0.3rem 0.45rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s ease;
  flex-shrink: 0;
}

.symbol-search-btn:hover {
  background: #d9892e;
}

.btn-icon {
  width: 0.9rem;
  height: 0.9rem;
  flex-shrink: 0;
}

/* Divider */
.toolbar-divider {
  width: 1px;
  height: 1.4rem;
  background: var(--color-border);
  flex-shrink: 0;
}

/* Spacer */
.toolbar-spacer {
  flex: 1;
}

/* Sync crosshair toggle */
.sync-btn {
  display:         flex;
  align-items:     center;
  justify-content: center;
  background:      none;
  border:          1px solid var(--color-border);
  color:           var(--color-text-soft);
  padding:         0 0.45rem;
  height:          1.75rem;
  border-radius:   var(--radius-sm);
  cursor:          pointer;
  transition:      all 0.15s ease;
  flex-shrink:     0;
}

.sync-btn:hover {
  color:        var(--color-text);
  border-color: #555;
}

.sync-btn.active {
  background:   #c87628;
  border-color: #c87628;
  color:        #fff;
}

.sync-btn.active:hover {
  background:   #d9892e;
  border-color: #d9892e;
}

.sync-btn.ctrl-hint,
.tool-btn.ctrl-hint {
  border-color: #c87628;
  color:        #c87628;
}

.sync-icon {
  width:  13px;
  height: 13px;
  flex-shrink: 0;
}

/* Drawing tool buttons */
.tool-btn {
  display:         flex;
  align-items:     center;
  justify-content: center;
  background:      none;
  border:          1px solid var(--color-border);
  color:           var(--color-text-soft);
  padding:         0 0.45rem;
  height:          1.75rem;
  border-radius:   var(--radius-sm);
  cursor:          pointer;
  transition:      color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  flex-shrink:     0;
}

.tool-btn:hover {
  color:        var(--color-text);
  border-color: #555;
}

.tool-btn.active {
  background:   #c87628;
  border-color: #c87628;
  color:        #fff;
}

.tool-icon {
  width:       1.4rem;
  height:      0.9rem;
  flex-shrink: 0;
  display:     block;
}

/* Vertical line icon is portrait — keep it visually balanced */
.tool-icon--tall {
  width:  0.65rem;
}
.tool-icon--ruler {
  width:  1.4rem;
}

.delete-btn {
  display:       flex;
  align-items:   center;
  gap:           0.35rem;
  background:    none;
  border:        1px solid #8b3030;
  color:         #e05555;
  font-size:     0.82rem;
  font-weight:   600;
  padding:       0 0.65rem;
  height:        1.75rem;
  border-radius: var(--radius-sm);
  cursor:        pointer;
  transition:    all 0.15s ease;
  flex-shrink:   0;
  white-space:   nowrap;
}

.delete-btn:hover {
  background:   #c43a3a;
  border-color: #c43a3a;
  color:        #fff;
}
</style>
