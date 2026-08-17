<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onUnmounted } from 'vue'
import type { ShallowRef } from 'vue'
import PulseChartPanel from '~/components/chart/PulseChartPanel.vue'
import ChartToolbar from '~/components/chart/ChartToolbar.vue'
import type { OHLCBar, BarMarker } from '~/components/chart/PulseChart.vue'
import { subscribeBars, type BarsEvent } from '~/composables/useScanner'
import { useChartTabs } from '~/composables/useChartTabs'
import LoadingOverlay from '~/components/common/LoadingOverlay.vue'

const props = defineProps<{
  symbol:    string
  basePrice: number
}>()

const { setTabLoading } = useChartTabs()

// ── Panel layout ──────────────────────────────────────────────────────────────
interface Panel {
  key:         'M' | 'W' | 'D' | '60' | '30' | '5' | '1' | '10s'
  label:       string
  title:       string
  timeVisible: boolean
}

const PANELS: Panel[] = [
  { key: 'D',   label: 'D',   title: 'Daily',    timeVisible: false },
  { key: '5',   label: '5M',  title: '5-min',    timeVisible: true  },
  { key: '1',   label: '1M',  title: '1-min',    timeVisible: true  },
  { key: '10s', label: '10s', title: '10-sec',   timeVisible: true  },
]

// ── Per-panel reactive state ──────────────────────────────────────────────────
// shallowRef: only the array reference is tracked — swap the whole array on update.
const panelBars:    ShallowRef<OHLCBar[]>[]   = PANELS.map(() => shallowRef([]))
const panelMarkers: ShallowRef<BarMarker[]>[] = PANELS.map(() => shallowRef([]))

function panelIndex(key: Panel['key']): number {
  return PANELS.findIndex(p => p.key === key)
}

// ── State ─────────────────────────────────────────────────────────────────────
const loading    = ref(false)
const refreshing = ref(false)
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

// ── Weekly bar aggregation (client-side, from patched daily bars) ─────────────
// Mirrors the server's aggregateToWeekly logic but operates on OHLCBar[] (time
// in unix seconds) so the patched today-bar is included.
function isoWeekKeySec(timeSec: number): string {
  const d = new Date(timeSec * 1000)
  const day = d.getUTCDay() || 7          // 1=Mon … 7=Sun
  const thu = new Date(d)
  thu.setUTCDate(d.getUTCDate() + 4 - day)
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((thu.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7)
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function buildWeeklyBars(dailyBars: OHLCBar[]): OHLCBar[] {
  if (!dailyBars.length) return []
  const buckets = new Map<string, OHLCBar[]>()
  for (const b of dailyBars) {
    const k = isoWeekKeySec(b.time)
    const arr = buckets.get(k) ?? []
    arr.push(b)
    buckets.set(k, arr)
  }
  const result: OHLCBar[] = []
  for (const [, bars] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    result.push({
      time:  bars[0]!.time,
      open:  bars[0]!.open,
      high:  Math.max(...bars.map(b => b.high)),
      low:   Math.min(...bars.map(b => b.low)),
      close: bars[bars.length - 1]!.close,
    })
  }
  return result
}

// ── ET timezone helpers (mirror server et-time.ts) ─────────────────────────────
function dstStartUtcMs(year: number): number {
  const marchFirst = Date.UTC(year, 2, 1)
  const dow = new Date(marchFirst).getUTCDay()
  const firstSunday = 1 + ((7 - dow) % 7)
  return Date.UTC(year, 2, firstSunday + 7, 7)
}

function dstEndUtcMs(year: number): number {
  const novFirst = Date.UTC(year, 10, 1)
  const dow = new Date(novFirst).getUTCDay()
  const firstSunday = 1 + ((7 - dow) % 7)
  return Date.UTC(year, 10, firstSunday, 6)
}

/** ET offset (seconds) to add to a UTC timestamp to get the ET wall clock. */
function etOffsetSec(tsSec: number): number {
  const ts = tsSec * 1000
  const year = new Date(ts).getUTCFullYear()
  const start = dstStartUtcMs(year)
  const end = dstEndUtcMs(year)
  return ts >= start && ts < end ? -4 * 3600 : -5 * 3600
}

/** UTC seconds of 00:00 ET on the day containing tsSec. */
function todayEtSec(tsSec: number): number {
  const offset = etOffsetSec(tsSec)
  const et = new Date((tsSec + offset) * 1000)
  return Math.floor(Date.UTC(et.getUTCFullYear(), et.getUTCMonth(), et.getUTCDate()) / 1000) - offset
}

// ── Strat bar-type markers ────────────────────────────────────────────────────────
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
    `/api/scanner/chart-bars?symbol=${encodeURIComponent(props.symbol)}`,
    { timeout: 20_000 }
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

// ── Synthesise today's partial daily bar from intraday (1-min) data ───────────
// The D-bar DB only contains closed sessions. During a live trading session
// today's bar doesn't exist yet, so the daily chart's last close (yesterday)
// differs from the intraday charts. This builds the missing bar.
function buildTodayBarFrom(minutes: OHLCBar[], todaySec: number): OHLCBar | null {
  const today = minutes.filter(b => b.time >= todaySec)
  if (today.length === 0) return null
  return {
    time:  todaySec,
    open:  today[0]!.open,
    high:  Math.max(...today.map(b => b.high)),
    low:   Math.min(...today.map(b => b.low)),
    close: today[today.length - 1]!.close,
  }
}

// ── Intraday aggregation (mirrors the server's aggregateMinuteBars) ───────────
// Groups 1-minute bars into N-minute candles using epoch-aligned bucket keys.
// The 5M panel is derived from the 1M series so it always tracks the live 1M
// updates (the server's real 5M series only advances on the provider's cadence).
function aggregateMinutes(minutes: OHLCBar[], intervalMin: number): OHLCBar[] {
  const bucketSec = intervalMin * 60
  const buckets = new Map<number, OHLCBar[]>()
  for (const b of minutes) {
    const key = Math.floor(b.time / bucketSec) * bucketSec
    const arr = buckets.get(key) ?? []
    arr.push(b)
    buckets.set(key, arr)
  }
  const result: OHLCBar[] = []
  for (const [key, group] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    result.push({
      time:  key,
      open:  group[0]!.open,
      high:  Math.max(...group.map(b => b.high)),
      low:   Math.min(...group.map(b => b.low)),
      close: group[group.length - 1]!.close,
    })
  }
  return result
}

// ── Build chart data ──────────────────────────────────────────────────────────
const FALLBACK_COUNTS: Record<string, number> = { M: 36, W: 52, D: 100, '60': 80, '30': 80, '5': 80, '1': 60, '10s': 60 }
const FALLBACK_VOL:    Record<string, number> = { M: 0.045, W: 0.028, D: 0.015, '60': 0.005, '30': 0.007, '5': 0.003, '1': 0.003, '10s': 0.002 }

async function buildCharts(): Promise<void> {
  setTabLoading(props.symbol, true)
  loading.value = true

  let realBars: Record<string, OHLCBar[]> = {}
  try { realBars = await fetchBars() } catch { /* fall back to seeded demo */ }

  const hasReal = Object.keys(realBars).length > 0
  dataSource.value = hasReal ? 'real' : 'demo'

  // Patch today's partial D bar from intraday so D panel shows today
  if (hasReal && realBars['D']?.length) {
    const todaySec = todayEtSec(Math.floor(Date.now() / 1000))
    const lastDTs  = realBars['D'][realBars['D'].length - 1]!.time
    if (lastDTs < todaySec) {
      const todayBar = buildTodayBarFrom(realBars['1'] ?? realBars['5'] ?? [], todaySec)
      if (todayBar) realBars['D'] = [...realBars['D'], todayBar]
    }
  }

  // Rebuild weekly bars from the patched daily bars so the current week
  // (and today's partial bar) is reflected correctly.
  if (hasReal && realBars['D']?.length) {
    realBars['W'] = buildWeeklyBars(realBars['D'])
  }

  // Populate per-panel data BEFORE setting loading = false so charts mount with data
  PANELS.forEach((panel, idx) => {
    if (panel.key === '5') return // 5M is derived from the 1M series below
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

  // 5M panel — derived from the 1M series so it stays current with live updates.
  refreshDerived()

  setTabLoading(props.symbol, false)
  loading.value = false
  flushPendingBars()
}

// ── Event-driven bar updates (from the data layer via SSE) ────────────────────
// The data layer advances the cache/DB on every new period and pushes the new
// candles here. We append newer candles and replace the current candle when its
// completed values arrive — the chart never polls or refreshes.

// Bar events arriving while the initial load is still in flight are queued and
// applied once the panels are populated (so a first broadcast that backfills a
// stale-DB gap is never lost).
let pendingBars: BarsEvent[] = []

function flushPendingBars(): void {
  if (loading.value || pendingBars.length === 0) return
  const q = pendingBars
  pendingBars = []
  for (const msg of q) applyBarsNow(msg)
}

/** Append newer bars / replace the current candle in one panel. Returns true when changed. */
function applyToPanel(key: Panel['key'], bars: ApiBar[]): boolean {
  const idx = panelIndex(key)
  if (idx === -1) return false
  const cur = panelBars[idx]!.value
  if (!cur.length) return false
  let out = [...cur]
  let changed = false
  for (const b of bars) {
    const t = Math.floor(b.t / 1000)
    const last = out[out.length - 1]!
    if (t > last.time) {
      out.push({ time: t, open: b.o, high: b.h, low: b.l, close: b.c })
      changed = true
    } else if (t === last.time) {
      out[out.length - 1] = { time: t, open: b.o, high: b.h, low: b.l, close: b.c }
      changed = true
    }
  }
  if (changed) {
    panelBars[idx]!.value = out
    panelMarkers[idx]!.value = computeMarkers(out)
  }
  return changed
}

/** Rebuild the 5M panel from the 1-min series and refresh the D today bar. */
function refreshDerived(): void {
  const fiveIdx = panelIndex('5')
  const oneIdx  = panelIndex('1')
  if (fiveIdx === -1 || oneIdx === -1) return
  const five = aggregateMinutes(panelBars[oneIdx]!.value, 5)
  panelBars[fiveIdx]!.value = five
  panelMarkers[fiveIdx]!.value = computeMarkers(five)
  refreshTodayBar()
}

/** Rebuild the D panel's today bar from the current 1-min series. */
function refreshTodayBar(): void {
  const idxD = panelIndex('D')
  const minIdx = panelIndex('1')
  if (idxD === -1 || minIdx === -1) return
  const dArr = panelBars[idxD]!.value
  if (!dArr.length) return
  const todaySec = todayEtSec(Math.floor(Date.now() / 1000))
  const todayBar = buildTodayBarFrom(panelBars[minIdx]!.value, todaySec)
  if (!todayBar) return
  const last = dArr[dArr.length - 1]!
  if (last.time < todaySec) {
    panelBars[idxD]!.value = [...dArr, todayBar]
  } else if (last.time === todaySec) {
    panelBars[idxD]!.value = [...dArr.slice(0, -1), todayBar]
  } else {
    return
  }
  panelMarkers[idxD]!.value = computeMarkers(panelBars[idxD]!.value)
}

/** Merge newly-closed daily bars into the D panel history, then re-add today. */
function applyDayHistory(bars: ApiBar[]): void {
  const idxD = panelIndex('D')
  if (idxD === -1) return
  const cur = panelBars[idxD]!.value
  if (!cur.length) return
  const todaySec = todayEtSec(Math.floor(Date.now() / 1000))
  const merged = cur.filter(b => b.time < todaySec)
  let changed = false
  for (const b of bars) {
    const t = Math.floor(b.t / 1000)
    if (t >= todaySec) continue
    const bar = { time: t, open: b.o, high: b.h, low: b.l, close: b.c }
    const last = merged[merged.length - 1]
    if (!last || t > last.time) { merged.push(bar); changed = true }
    else if (t === last.time) { merged[merged.length - 1] = bar; changed = true }
  }
  if (changed) {
    panelBars[idxD]!.value = merged
    refreshTodayBar()
  }
}

function applyBarsUpdate(msg: BarsEvent): void {
  if (msg.symbol !== props.symbol || msg.bars.length === 0) return
  if (loading.value) {
    pendingBars.push(msg)
    return
  }
  applyBarsNow(msg)
}

function applyBarsNow(msg: BarsEvent): void {
  if (msg.timespan === 'minute') {
    // The 5M panel is derived from the 1M series, so a 1M update flows through
    // to 5M (and D's today bar) automatically.
    if (applyToPanel('1', msg.bars)) refreshDerived()
  } else if (msg.timespan === 'day') {
    applyDayHistory(msg.bars)
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let unsubscribeBars: (() => void) | null = null

onMounted(() => {
  unsubscribeBars = subscribeBars(applyBarsUpdate)
  // Register as a chart watcher so the data layer keeps this symbol's series
  // fresh on every new period and pushes the new candles here as events.
  void $fetch('/api/scanner/chart-watch', { method: 'POST', body: { symbol: props.symbol, action: 'watch' } })
})

onUnmounted(() => {
  unsubscribeBars?.()
  unsubscribeBars = null
  void $fetch('/api/scanner/chart-watch', { method: 'POST', body: { symbol: props.symbol, action: 'unwatch' } })
})

/** Force the data layer to re-sync this symbol's series now; fresh bars arrive via SSE. */
async function handleRefresh(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await $fetch('/api/scanner/chart-refresh', { method: 'POST', body: { symbol: props.symbol }, timeout: 60_000 })
  } catch { /* chart keeps its current series on failure */ } finally {
    refreshing.value = false
  }
}

// Rebuild when symbol changes
watch(() => props.symbol, buildCharts, { immediate: true })
</script>

<template>
  <div class="symbol-chart-view">
    <ChartToolbar :refreshing="refreshing" @refresh="handleRefresh" />

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
