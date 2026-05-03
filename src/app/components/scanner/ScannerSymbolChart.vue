<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps<{
  symbol: string
  basePrice: number
}>()

// ── Panel definitions ──────────────────────────────────────
type TF = '1M' | '1W' | '1D' | '1h'

interface Panel {
  tf: TF
  title: string
}

const PANELS: Panel[] = [
  { tf: '1M', title: 'Monthly' },
  { tf: '1W', title: 'Weekly' },
  { tf: '1D', title: 'Daily' },
  { tf: '1h', title: 'Hourly' },
]

const COUNTS: Record<TF, number> = { '1M': 36, '1W': 52, '1D': 100, '1h': 42 }

// Container element refs for each panel
const containerRefs = ref<(HTMLElement | null)[]>([null, null, null, null])

function setContainerRef(index: number, el: Element | null) {
  containerRefs.value[index] = el as HTMLElement | null
}

// ── Deterministic seeded RNG ───────────────────────────────
function symbolSeed(sym: string, extra = 0): number {
  return sym.split('').reduce((acc, c, i) => acc + c.charCodeAt(0) * (i + 1) * 31, 0) + extra
}

function seededRng(seed: number) {
  let s = Math.abs(seed) % 2_147_483_647 || 1
  return function next() {
    s = (s * 16807) % 2_147_483_647
    return (s - 1) / 2_147_483_646
  }
}

// ── OHLC data generator ────────────────────────────────────
interface OHLCBar {
  time: number // UTCTimestamp in seconds
  open: number
  high: number
  low: number
  close: number
}

const MS_PER_BAR: Record<TF, number> = {
  '1M': 30 * 24 * 3600 * 1000,
  '1W': 7 * 24 * 3600 * 1000,
  '1D': 24 * 3600 * 1000,
  '1h': 3600 * 1000,
}

const VOLATILITY: Record<TF, number> = {
  '1M': 0.045,
  '1W': 0.028,
  '1D': 0.015,
  '1h': 0.007,
}

function generateOHLC(basePrice: number, count: number, rng: () => number, tf: TF): OHLCBar[] {
  const endMs = new Date('2026-05-02T20:00:00Z').getTime()
  const intervalMs = MS_PER_BAR[tf]
  const vol = VOLATILITY[tf]

  // Build close prices backward from basePrice, then reverse
  const closes: number[] = [basePrice]
  for (let i = 1; i < count; i++) {
    const prev = closes[closes.length - 1]!
    const drift = (rng() - 0.51) * prev * vol
    closes.push(Math.max(prev + drift, 1))
  }
  closes.reverse()

  const data: OHLCBar[] = []
  for (let i = 0; i < count; i++) {
    const ts = endMs - (count - 1 - i) * intervalMs
    const close = closes[i]!
    const open = i === 0
      ? close * (1 + (rng() - 0.5) * vol * 2)
      : closes[i - 1]!
    const range = Math.abs(close - open)
    const wickFactor = 0.3 + rng() * 0.7
    const high = Math.max(open, close) + range * wickFactor + 0.01
    const low = Math.min(open, close) - range * (0.2 + rng() * 0.5) - 0.01

    data.push({
      time: Math.floor(ts / 1000),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +Math.max(low, 0.01).toFixed(2),
      close: +close.toFixed(2),
    })
  }
  return data
}

// ── Strat bar-type markers (1 = inside, 3 = outside) ──────
function computeMarkers(data: OHLCBar[]) {
  const markers: object[] = []
  for (let i = 1; i < data.length; i++) {
    const c = data[i]!
    const p = data[i - 1]!
    const isInside  = c.high <= p.high && c.low >= p.low
    const isOutside = c.high > p.high  && c.low < p.low
    if (isInside) {
      markers.push({ time: c.time, position: 'aboveBar', color: '#f59e0b', text: '1', size: 0.5 })
    } else if (isOutside) {
      markers.push({ time: c.time, position: 'aboveBar', color: '#ec4899', text: '3', size: 0.5 })
    }
  }
  return markers
}

// ── Chart lifecycle ────────────────────────────────────────
let chartInstances: { remove: () => void }[] = []

async function buildCharts() {
  const { createChart } = await import('lightweight-charts')

  destroyCharts()

  PANELS.forEach((panel, idx) => {
    const el = containerRefs.value[idx]
    if (!el) return

    const isHourly = panel.tf === '1h'

    const chart = createChart(el, {
      layout: {
        background: { type: 'solid' as const, color: '#111' },
        textColor: '#9ca3af',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e1e1e' },
        horzLines: { color: '#1e1e1e' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: {
        borderColor: '#2a2a2a',
        scaleMargins: { top: 0.08, bottom: 0.05 },
      },
      timeScale: {
        borderColor: '#2a2a2a',
        rightOffset: 5,
        timeVisible: isHourly,
        secondsVisible: false,
      },
      autoSize: true,
    } as Parameters<typeof createChart>[1])

    const rng = seededRng(symbolSeed(props.symbol, idx * 7919))
    const count = COUNTS[panel.tf]
    const data = generateOHLC(props.basePrice, count, rng, panel.tf)
    const markers = computeMarkers(data)

    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })

    series.setData(data as Parameters<typeof series.setData>[0])
    series.setMarkers(markers as Parameters<typeof series.setMarkers>[0])
    // Show same number of visible bars as the monthly chart (36)
    const visibleBars = COUNTS['1M']
    chart.timeScale().setVisibleLogicalRange({ from: count - 1 - visibleBars, to: count - 1 + 5 })

    chartInstances.push(chart)
  })
}

function destroyCharts() {
  chartInstances.forEach(c => { try { c.remove() } catch (_) {} })
  chartInstances = []
}

onMounted(() => { buildCharts() })
onUnmounted(() => { destroyCharts() })
watch(() => props.symbol, () => { buildCharts() })
</script>

<template>
  <div class="symbol-chart-view">
    <div class="chart-grid">
      <div
        v-for="(panel, i) in PANELS"
        :key="panel.tf"
        class="chart-panel"
      >
        <div class="chart-panel-header">
          <span class="chart-symbol">{{ symbol }}</span>
          <span class="chart-sep"> · </span>
          <span class="chart-tf">{{ panel.tf }}</span>
          <span class="chart-tf-full"> – {{ panel.title }}</span>
        </div>
        <div
          :ref="(el) => setContainerRef(i, el as Element | null)"
          class="chart-container"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.symbol-chart-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  background: #2a2a2a;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.chart-panel {
  display: flex;
  flex-direction: column;
  background: #0f0f0f;
  overflow: hidden;
  min-height: 0;
}

.chart-panel-header {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0.3rem 0.75rem;
  background: #141414;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
  font-size: 0.82rem;
  line-height: 1.4;
}

.chart-symbol {
  font-weight: 700;
  color: #e5e7eb;
  letter-spacing: 0.03em;
}

.chart-sep {
  color: #444;
  margin: 0 0.25rem;
}

.chart-tf {
  font-weight: 600;
  color: #c87628;
}

.chart-tf-full {
  color: #555;
  font-size: 0.75rem;
  margin-left: 0.3rem;
}

.chart-container {
  flex: 1;
  min-height: 0;
  position: relative;
}
</style>
