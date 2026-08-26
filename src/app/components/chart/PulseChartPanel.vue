<script setup lang="ts">
import { ref, watch } from 'vue'
import PulseChartHeader from './PulseChartHeader.vue'
import PulseChart, { type OHLCBar, type BarMarker, type ChartOverlays } from './PulseChart.vue'
import type { OverlayId } from '~/utils/indicators'

const props = defineProps<{
  symbol:      string
  label:       string
  timeVisible: boolean
  showSeconds: boolean
  bars:        OHLCBar[]
  markers:     BarMarker[]
  isDemo:      boolean
  loadMoreBusy?: boolean
  loadMoreExhausted?: boolean
  maximized?: boolean
}>()

const emit = defineEmits<{
  (e: 'load-more', payload: { before: number }): void
  (e: 'maximize'): void
}>()

// ── Indicator overlay toggles (per-timeframe state, persisted) ───────────────
const DEFAULT_OVERLAYS: ChartOverlays = {
  ema9: false,
  ema20: true,
  ema200: false,
  vwap: false,
  volume: true,
  macd: false,
  dayStart: false,
  sessions: false,
}

function storageKey(): string {
  return `pulse-overlays-${props.label}`
}

function loadOverlays(): ChartOverlays {
  try {
    const raw = localStorage.getItem(storageKey())
    if (raw) return { ...DEFAULT_OVERLAYS, ...JSON.parse(raw) as Partial<ChartOverlays> }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_OVERLAYS }
}

const overlays = ref<ChartOverlays>(loadOverlays())

watch(overlays, (v) => {
  try { localStorage.setItem(storageKey(), JSON.stringify(v)) } catch { /* storage unavailable */ }
}, { deep: true })

function toggleOverlay(id: OverlayId): void {
  overlays.value = { ...overlays.value, [id]: !overlays.value[id] }
}
</script>

<template>
  <div class="pulse-panel">
    <PulseChartHeader
      :symbol="symbol"
      :label="label"
      :is-demo="isDemo"
      :overlays="overlays"
      :maximized="maximized"
      @toggle-overlay="toggleOverlay"
      @maximize="emit('maximize')"
    />
    <PulseChart
      class="panel-chart"
      :bars="bars"
      :markers="markers"
      :time-visible="timeVisible"
      :show-seconds="showSeconds"
      :overlays="overlays"
      :load-more-busy="loadMoreBusy"
      :load-more-exhausted="loadMoreExhausted"
      @load-more="emit('load-more', $event)"
    />
  </div>
</template>

<style scoped>
.pulse-panel {
  display:        flex;
  flex-direction: column;
  overflow:       hidden;
  min-height:     0;
  background:     #131722;
}

.panel-chart {
  flex:       1;
  min-height: 0;
}
</style>
