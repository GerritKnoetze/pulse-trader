<script setup lang="ts">
import { ref, computed, shallowRef, watch } from 'vue'
import type { ShallowRef } from 'vue'
import PulseChartPanel from '~/components/chart/PulseChartPanel.vue'
import ChartToolbar from '~/components/chart/ChartToolbar.vue'
import type { OHLCBar, BarMarker } from '~/components/chart/PulseChart.vue'
import { useScanner } from '~/composables/useScanner'
import LoadingOverlay from '~/components/common/LoadingOverlay.vue'

const props = defineProps<{
  symbol:    string
  basePrice: number
}>()

// ── Live data (scanner SSE stream) ────────────────────────────────────────────
const { rows } = useScanner()
const currentRow = computed(() => rows.value.find(r => r.symbol === props.symbol))

// ── Panel layout ──────────────────────────────────────────────────────────────
interface Panel {
  key:         'M' | 'W' | 'D' | '60' | '30' | '5'
  label:       string
  title:       string
  timeVisible: boolean
}

const PANELS: Panel[] = [
  { key: 'W',  label: 'W',  title: 'Weekly', timeVisible: false },
  { key: 'D',  label: 'D',  title: 'Daily',  timeVisible: false },
  { key: '60', label: '1H', title: '1-Hour', timeVisible: true  },
  { key: '5',  label: '5M', title: '5-min',  timeVisible: true  },
]

// ── Per-panel reactive state ──────────────────────────────────────────────────
// shallowRef: only the array reference is tracked — swap the whole array on update.
const panelBars:    ShallowRef<OHLCBar[]>[]   = PANELS.map(() => shallowRef([]))
const panelMarkers: ShallowRef<BarMarker[]>[] = PANELS.map(() => shallowRef([]))


// ── State ─────────────────────────────────────────────────────────────────────
const loading    = ref(false)
const dataSource = ref<'real' | 'demo'>('demo')

// ── Seeded demo-data fallback ─────────────────────────────────────────────────
function symbolSeed(sym: string, extra = 0): number {
  return sym.split('').reduce((acc, c, i) => acc + c.charCodeAt(0) * (i + 1) * 31, 0) + extra
}
function seededRng(seed: number): () => number {
  let s = Math.abs(seed) % 2_147_483_647 || 1
  return () => { s = (s * 16807) % 2_147_483_647; return (s - 1) / 2_147_483_646 }
}

function generateOHLC(base: number, count: number, rng: () => number, volFactor: number): OHLCBar[] {
  const endMs      = Date.now()
  const intervalMs = 24 * 3600 * 1000
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
function computeMarkers(data: OHLCBar[]): BarMarker[] {
  const out: BarMarker[] = []
  for (let i = 1; i < data.length; i++) {
    const c = data[i]!, p = data[i - 1]!
    const inside  = c.high <= p.high && c.low >= p.low
    const outside = c.high >  p.high && c.low <  p.low
    if (inside)  out.push({ barIndex: i, text: '1', color: '#9ca3af' })
    if (outside) out.push({ barIndex: i, text: '3', color: '#ec4899' })
  }
  return out
}

// ── API response types ────────────────────────────────────────────────────────
interface ApiBar   { t: number; o: number; h: number; l: number; c: number; v: number }
interface BarsResp { symbol: string; bars: Record<string, ApiBar[]> }

async function fetchBars(): Promise<Record<string, OHLCBar[]>> {
  const data = await $fetch<BarsResp>(
    `/api/scanner/chart-bars?symbol=${encodeURIComponent(props.symbol)}`
  )
  const out: Record<string, OHLCBar[]> = {}
  for (const [key, arr] of Object.entries(data.bars)) {
    if (arr.length > 0) {
      out[key] = arr
        .sort((a, b) => a.t - b.t)
        .map(b => ({ time: Math.floor(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c }))
    }
  }
  return out
}

// ── Synthesise today's partial daily bar from 5-min intraday data ─────────────
// The D-bar DB only contains closed sessions. During a live trading session
// today's bar doesn't exist yet, so the daily chart's last close (yesterday)
// differs from the intraday charts. This builds the missing bar.
function buildTodayDBar(realBars: Record<string, OHLCBar[]>): OHLCBar | null {
  const min5 = realBars['5']
  if (!min5 || min5.length === 0) return null
  const todaySec = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
  const todayBars = min5.filter(b => b.time >= todaySec)
  if (todayBars.length === 0) return null
  return {
    time:  todaySec,
    open:  todayBars[0]!.open,
    high:  Math.max(...todayBars.map(b => b.high)),
    low:   Math.min(...todayBars.map(b => b.low)),
    close: todayBars[todayBars.length - 1]!.close,
  }
}

// ── Build chart data ──────────────────────────────────────────────────────────
const FALLBACK_COUNTS: Record<string, number> = { M: 36, W: 52, D: 100, '60': 80, '30': 80, '5': 80 }
const FALLBACK_VOL:    Record<string, number> = { M: 0.045, W: 0.028, D: 0.015, '60': 0.005, '30': 0.007, '5': 0.003 }

async function buildCharts(): Promise<void> {
  loading.value = true

  let realBars: Record<string, OHLCBar[]> = {}
  try { realBars = await fetchBars() } catch { /* fall back to seeded demo */ }

  const hasReal = Object.keys(realBars).length > 0
  dataSource.value = hasReal ? 'real' : 'demo'

  // Patch today's partial D bar from 5-min intraday so D panel shows today
  if (hasReal && realBars['D']) {
    const todaySec = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
    const lastDTs  = realBars['D'][realBars['D'].length - 1]?.time ?? 0
    if (lastDTs < todaySec) {
      const todayBar = buildTodayDBar(realBars)
      if (todayBar) {
        const livePrice = currentRow.value?.last
        if (livePrice) {
          todayBar.close = livePrice
          todayBar.high  = Math.max(todayBar.high, livePrice)
          todayBar.low   = Math.min(todayBar.low,  livePrice)
        }
        realBars['D'] = [...realBars['D'], todayBar]
      }
    }
  }

  // Populate per-panel data BEFORE setting loading = false so charts mount with data
  PANELS.forEach((panel, idx) => {
    let data: OHLCBar[]
    if (hasReal && realBars[panel.key]?.length) {
      data = realBars[panel.key]!
    } else {
      const rng   = seededRng(symbolSeed(props.symbol, idx * 7919))
      const count = FALLBACK_COUNTS[panel.key] ?? 60
      const vol   = FALLBACK_VOL[panel.key]   ?? 0.015
      data = generateOHLC(props.basePrice, count, rng, vol)
    }
    panelBars[idx]!.value    = data
    panelMarkers[idx]!.value = computeMarkers(data)
  })

  loading.value = false
}

// ── Live price updates ────────────────────────────────────────────────────────
watch(currentRow, (newRow) => {
  if (!newRow || loading.value) return
  const livePrice = newRow.last
  if (!livePrice) return

  const todaySec = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)

  PANELS.forEach((panel, idx) => {
    const arr = panelBars[idx]!.value
    if (!arr.length) return

    const lb = arr[arr.length - 1]!
    let updated: OHLCBar

    if (panel.key === 'D') {
      if (lb.time >= todaySec) {
        updated = { time: lb.time, open: lb.open,
          high: Math.max(lb.high, livePrice), low: Math.min(lb.low, livePrice), close: livePrice }
      } else {
        // Append today's bar — new length triggers PulseChart watcher
        panelBars[idx]!.value = [...arr, {
          time: todaySec, open: livePrice, high: livePrice, low: livePrice, close: livePrice,
        }]
        return
      }
    } else {
      updated = { time: lb.time, open: lb.open,
        high: Math.max(lb.high, livePrice), low: Math.min(lb.low, livePrice), close: livePrice }
    }

    // Replace last element — new array reference triggers PulseChart watcher
    panelBars[idx]!.value = [...arr.slice(0, -1), updated]
  })
}, { deep: false })

// Rebuild when symbol changes
watch(() => props.symbol, buildCharts, { immediate: true })
</script>

<template>
  <div class="symbol-chart-view">
    <ChartToolbar />

    <LoadingOverlay v-if="loading" :label="`Loading bars for ${symbol}\u2026`" />

    <div v-else class="chart-grid">
      <PulseChartPanel
        v-for="(panel, i) in PANELS"
        :key="`${symbol}-${panel.key}`"
        class="chart-cell"
        :symbol="symbol"
        :label="panel.label"
        :title="panel.title"
        :time-visible="panel.timeVisible"
        :bars="panelBars[i]!.value"
        :markers="panelMarkers[i]!.value"
        :is-demo="dataSource === 'demo'"
      />
    </div>
  </div>
</template>

<style scoped>
.symbol-chart-view {
  flex:           1;
  display:        flex;
  flex-direction: column;
  overflow:       hidden;
  min-height:     0;
  background:     #121212;
}

.chart-grid {
  display:               grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows:    1fr 1fr;
  gap:                   1px;
  background:            #2a2a2a;
  flex:                  1;
  overflow:              hidden;
  min-height:            0;
}

.chart-cell {
  overflow:   hidden;
  min-height: 0;
}
</style>
