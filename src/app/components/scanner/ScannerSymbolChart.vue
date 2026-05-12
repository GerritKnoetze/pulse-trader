<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { StratSetup } from '~/types/scanner'

const props = defineProps<{
  symbol:    string
  basePrice: number
  setup?:    StratSetup   // optional — draws entry/stop/target overlays when provided
}>()

// ── Panel layout ──────────────────────────────────────────────────────────────
//   Top-left:   D  (trend context)
//   Top-right:  W  (higher-TF check)
//   Bot-left:   30 (signal / combo timeframe)
//   Bot-right:  5  (5-min entry / stop refinement)
// For swing setups (signal TF = D) we swap intraday panels for M/W.

interface Panel {
  key:   'M' | 'W' | 'D' | '60' | '30' | '5'
  label: string
  title: string
}

// Fixed 4-panel layout per spec: D (trend) · 1H (check) · 30M (combo) · 5M (entry)
function buildPanels(): Panel[] {
  return [
    { key: 'D',  label: 'D',   title: 'Daily'  },
    { key: '60', label: '1H',  title: '1-Hour' },
    { key: '30', label: '30M', title: '30-min' },
    { key: '5',  label: '5M',  title: '5-min'  },
  ]
}

// ── Container refs ────────────────────────────────────────────────────────────
const containerRefs = ref<(HTMLElement | null)[]>([null, null, null, null])
function setContainerRef(index: number, el: Element | null) {
  containerRefs.value[index] = el as HTMLElement | null
}

// ── Loading state ─────────────────────────────────────────────────────────────
const loading = ref(false)
const dataSource = ref<'real' | 'demo'>('demo')

// ── Seeded fallback (keeps existing behaviour when no real data) ──────────────
function symbolSeed(sym: string, extra = 0): number {
  return sym.split('').reduce((acc, c, i) => acc + c.charCodeAt(0) * (i + 1) * 31, 0) + extra
}
function seededRng(seed: number) {
  let s = Math.abs(seed) % 2_147_483_647 || 1
  return () => { s = (s * 16807) % 2_147_483_647; return (s - 1) / 2_147_483_646 }
}

interface OHLCBar { time: number; open: number; high: number; low: number; close: number }

function generateOHLC(base: number, count: number, rng: () => number, volFactor: number): OHLCBar[] {
  const endMs = Date.now()
  const intervalMs = 24 * 3600 * 1000  // use daily spacing for fallback
  const closes: number[] = [base]
  for (let i = 1; i < count; i++) {
    const prev = closes[closes.length - 1]!
    closes.push(Math.max(prev + (rng() - 0.51) * prev * volFactor, 1))
  }
  closes.reverse()
  return closes.map((close, i) => {
    const ts    = Math.floor((endMs - (count - 1 - i) * intervalMs) / 1000)
    const open  = i === 0 ? close * (1 + (rng() - 0.5) * volFactor * 2) : closes[i - 1]!
    const range = Math.abs(close - open)
    const wick  = 0.3 + rng() * 0.7
    return {
      time:  ts,
      open:  +open.toFixed(2),
      high:  +(Math.max(open, close) + range * wick + 0.01).toFixed(2),
      low:   +(Math.max(Math.min(open, close) - range * (0.2 + rng() * 0.5) - 0.01, 0.01)).toFixed(2),
      close: +close.toFixed(2),
    }
  })
}

// ── Strat bar-type markers ────────────────────────────────────────────────────
function computeMarkers(data: OHLCBar[]) {
  const markers: object[] = []
  for (let i = 1; i < data.length; i++) {
    const c = data[i]!, p = data[i - 1]!
    const inside  = c.high <= p.high && c.low >= p.low
    const outside = c.high >  p.high && c.low <  p.low
    if (inside)  markers.push({ time: c.time, position: 'aboveBar', color: '#f59e0b', text: '1', size: 0.5 })
    if (outside) markers.push({ time: c.time, position: 'aboveBar', color: '#ec4899', text: '3', size: 0.5 })
  }
  return markers
}

// ── API response shape ────────────────────────────────────────────────────────
interface ApiBar   { t: number; o: number; h: number; l: number; c: number; v: number }
interface BarsResp { symbol: string; bars: Record<string, ApiBar[]> }

async function fetchBars(): Promise<Record<string, OHLCBar[]>> {
  const data = await $fetch<BarsResp>(`/api/scanner/chart-bars?symbol=${encodeURIComponent(props.symbol)}`)
  const out: Record<string, OHLCBar[]> = {}
  for (const [key, arr] of Object.entries(data.bars)) {
    if (arr.length > 0) {
      out[key] = arr
        .sort((a, b) => a.t - b.t)
        .map(b => ({
          time:  Math.floor(b.t / 1000),
          open:  b.o, high: b.h, low: b.l, close: b.c,
        }))
    }
  }
  return out
}

// ── Chart lifecycle ───────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chartInstances: { remove: () => void }[] = []

async function buildCharts() {
  const { createChart } = await import('lightweight-charts')
  destroyCharts()

  loading.value = true
  let realBars: Record<string, OHLCBar[]> = {}
  try {
    realBars = await fetchBars()
  } catch {
    // Fall back to seeded demo data
  }
  loading.value = false
  // Wait for Vue to re-render and mount the chart container divs
  await nextTick()

  const hasReal = Object.keys(realBars).length > 0
  dataSource.value = hasReal ? 'real' : 'demo'

  const panels = buildPanels()
  const FALLBACK_COUNTS: Record<string, number> = { M: 36, W: 52, D: 100, '60': 80, '30': 80, '5': 80 }
  const FALLBACK_VOL:    Record<string, number> = { M: 0.045, W: 0.028, D: 0.015, '60': 0.005, '30': 0.007, '5': 0.003 }

  panels.forEach((panel, idx) => {
    const el = containerRefs.value[idx]
    if (!el) return

    const isIntraday = panel.key === '60' || panel.key === '30' || panel.key === '5'

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
        scaleMargins: { top: 0.1, bottom: 0.05 },
      },
      timeScale: {
        borderColor: '#2a2a2a',
        rightOffset: 5,
        timeVisible: isIntraday,
        secondsVisible: false,
      },
      autoSize: true,
    } as Parameters<typeof createChart>[1])

    // Get bar data — real or fallback
    let data: OHLCBar[]
    if (hasReal && realBars[panel.key] && realBars[panel.key]!.length > 0) {
      data = realBars[panel.key]!
    } else {
      const rng   = seededRng(symbolSeed(props.symbol, idx * 7919))
      const count = FALLBACK_COUNTS[panel.key] ?? 60
      const vol   = FALLBACK_VOL[panel.key]   ?? 0.015
      data = generateOHLC(props.basePrice, count, rng, vol)
    }

    const markers = computeMarkers(data)

    const series = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })

    series.setData(data as Parameters<typeof series.setData>[0])
    series.setMarkers(markers as Parameters<typeof series.setMarkers>[0])

    // Visible range — show last 36 bars for higher TF, more for intraday
    const visibleBars = panel.key === 'D' ? 36 : 60
    const count = data.length
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, count - 1 - visibleBars),
      to: count - 1 + 5,
    })

    chartInstances.push(chart)
  })
}

function destroyCharts() {
  chartInstances.forEach(c => { try { c.remove() } catch (_) {} })
  chartInstances = []
}

onMounted(buildCharts)
onUnmounted(destroyCharts)
watch(() => props.symbol, buildCharts)
watch(() => props.setup,  buildCharts, { deep: false, immediate: true })
</script>

<template>
  <div class="symbol-chart-view">
    <!-- Loading state -->
    <div v-if="loading" class="chart-loading">
      <span class="chart-loading-text">Loading bars for {{ symbol }}…</span>
    </div>

    <div v-else class="chart-grid">
      <div
        v-for="(panel, i) in buildPanels()"
        :key="panel.key"
        class="chart-panel"
      >
        <div class="chart-panel-header">
          <span class="chart-symbol">{{ symbol }}</span>
          <span class="chart-sep"> · </span>
          <span class="chart-tf">{{ panel.label }}</span>
          <span class="chart-tf-full"> – {{ panel.title }}</span>
          <span v-if="dataSource === 'demo'" class="demo-badge">demo</span>
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

/* Loading */
.chart-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chart-loading-text {
  color: var(--color-text-soft);
  font-size: 0.85rem;
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

.chart-symbol  { font-weight: 700; color: #e5e7eb; letter-spacing: 0.03em; }
.chart-sep     { color: #444; margin: 0 0.25rem; }
.chart-tf      { font-weight: 600; color: #c87628; }
.chart-tf-full { color: #555; font-size: 0.75rem; margin-left: 0.3rem; }

.demo-badge {
  margin-left: auto;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
  background: rgba(100, 100, 100, 0.18);
  color: #666;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.chart-container {
  flex: 1;
  min-height: 0;
  position: relative;
}
</style>
