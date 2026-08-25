<script setup lang="ts">
import { ref, computed, shallowRef, watch, onMounted, onUnmounted } from 'vue'
import type { ShallowRef } from 'vue'
import PulseChartPanel from '~/components/chart/PulseChartPanel.vue'
import ChartToolbar from '~/components/chart/ChartToolbar.vue'
import type { OHLCBar, BarMarker } from '~/components/chart/PulseChart.vue'
import { extendIndicators } from '~/utils/indicators'
import { subscribeBars, type BarsEvent } from '~/composables/useScanner'
import { useScanner } from '~/composables/useScanner'
import { useChartTabs } from '~/composables/useChartTabs'
import LoadingOverlay from '~/components/common/LoadingOverlay.vue'

const props = defineProps<{
  symbol:    string
  basePrice: number
}>()

const { rows } = useScanner()
const { setTabLoading } = useChartTabs()

// The scanner row for this symbol — `last` is the live WS price and `ts` is the
// tick's feed-consistent timestamp (used to align the forming candle even when
// the feed is delayed relative to the local clock).
const currentRow = computed(() => rows.value.find(r => r.symbol === props.symbol))

// ── Panel layout ──────────────────────────────────────────────────────────────
interface Panel {
  key:         'M' | 'W' | 'D' | '60' | '30' | '5' | '1' | '10s'
  label:       string
  timeVisible: boolean
}

const PANELS: Panel[] = [
  { key: 'D',   label: 'D',   timeVisible: false },
  { key: '5',   label: '5M',  timeVisible: true  },
  { key: '1',   label: '1M',  timeVisible: true  },
  { key: '10s', label: '10s', timeVisible: true  },
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

/** UTC seconds of the current aligned period start for an intraday timeframe. */
function periodStartSec(key: Panel['key'], tsSec: number): number {
  const ms = tsSec * 1000
  if (key === '10s') return Math.floor(ms / 10_000) * 10_000 / 1000
  if (key === '1')   return Math.floor(ms / 60_000) * 60_000 / 1000
  if (key === '5')   return Math.floor(ms / 300_000) * 300_000 / 1000
  return 0
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
// The data service attaches indicator values to every bar (initial REST-backed
// load + live SSE updates), so the chart just maps them through to the panels.
interface ApiBar {
  t: number; o: number; h: number; l: number; c: number; v: number
  ema9?: number; ema20?: number; ema200?: number
  ema12?: number; ema26?: number
  macd?: number; macdSignal?: number; macdHist?: number
  vwap?: number
}
interface BarsResp { symbol: string; bars: Record<string, ApiBar[]> }

function toOHLC(b: ApiBar): OHLCBar {
  return {
    time:  Math.floor(b.t / 1000),
    open:  b.o, high: b.h, low: b.l, close: b.c,
    volume: b.v,
    ema9: b.ema9, ema20: b.ema20, ema200: b.ema200,
    ema12: b.ema12, ema26: b.ema26,
    macd: b.macd, macdSignal: b.macdSignal, macdHist: b.macdHist,
    vwap: b.vwap,
  }
}

async function fetchBars(): Promise<Record<string, OHLCBar[]>> {
  const data = await $fetch<BarsResp>(
    `/api/scanner/chart-bars?symbol=${encodeURIComponent(props.symbol)}`,
    { timeout: 20_000 }
  )
  const out: Record<string, OHLCBar[]> = {}
  for (const [key, arr] of Object.entries(data.bars)) {
    if (arr.length > 0) {
      out[key] = arr.sort((a, b) => a.t - b.t).map(toOHLC)
    }
  }
  return out
}

// ── Today's partial daily bar from the row's session `day` data ───────────────
// The D-bar DB only contains closed sessions. Today's bar comes from the row's
// `day {o,h,l,c}` (seeded from the market snapshot, kept live from WS ticks) —
// no derivation from the 1-minute series. Indicator values are extended from the
// previous closed daily bar so the overlay lines reach the right edge on load.
function todayBarFromRow(prev?: OHLCBar): OHLCBar | null {
  const day = currentRow.value?.day
  if (!day || day.o <= 0) return null
  const todaySec = todayEtSec(Math.floor(Date.now() / 1000))
  return {
    time: todaySec, open: day.o, high: day.h, low: day.l, close: day.c,
    ...extendIndicators(prev, day.c, currentRow.value?.vw),
  }
}

// ── Build chart data ──────────────────────────────────────────────────────────
async function buildCharts(): Promise<void> {
  setTabLoading(props.symbol, true)
  loading.value = true

  let realBars: Record<string, OHLCBar[]> = {}
  try { realBars = await fetchBars() } catch { /* keep empty — background seed fills via SSE */ }

  // Patch today's partial D bar from the row's session `day` data so D shows today
  if (realBars['D']?.length) {
    const todaySec = todayEtSec(Math.floor(Date.now() / 1000))
    const lastDTs  = realBars['D'][realBars['D'].length - 1]!.time
    if (lastDTs < todaySec) {
      const todayBar = todayBarFromRow(realBars['D'][realBars['D'].length - 1]!)
      if (todayBar) realBars['D'] = [...realBars['D'], todayBar]
    }
  }

  // Rebuild weekly bars from the patched daily bars so the current week
  // (and today's partial bar) is reflected correctly.
  if (realBars['D']?.length) {
    realBars['W'] = buildWeeklyBars(realBars['D'])
  }

  // Populate per-panel data BEFORE setting loading = false so charts mount with data
  PANELS.forEach((panel, idx) => {
    const data = realBars[panel.key] ?? []
    panelBars[idx]!.value    = data
    panelMarkers[idx]!.value = computeMarkers(data)
  })

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
  if (idx === -1 || bars.length === 0) return false
  const cur = panelBars[idx]!.value
  if (!cur.length || bars.length > cur.length) {
    // First data, or a full-series backfill (e.g. the 10s history seed arriving
    // after a few live buckets) — adopt the incoming series wholesale.
    const adopted = bars.map(toOHLC)
    panelBars[idx]!.value = adopted
    panelMarkers[idx]!.value = computeMarkers(adopted)
    return true
  }
  let out = [...cur]
  let changed = false
  for (const b of bars) {
    const t = Math.floor(b.t / 1000)
    const last = out[out.length - 1]!
    if (t > last.time) {
      out.push(toOHLC(b))
      changed = true
    } else if (t === last.time) {
      out[out.length - 1] = toOHLC(b)
      changed = true
    }
  }
  if (changed) {
    panelBars[idx]!.value = out
    panelMarkers[idx]!.value = computeMarkers(out)
  }
  return changed
}

/** Merge newly-closed daily bars into the D panel history, then re-add today.
 *  Handles a cold open too: when the panel is empty the incoming series is
 *  adopted wholesale (the background seed pushes the full daily history). */
function applyDayHistory(bars: ApiBar[]): void {
  const idxD = panelIndex('D')
  if (idxD === -1) return
  const todaySec = todayEtSec(Math.floor(Date.now() / 1000))
  const cur = panelBars[idxD]!.value
  // Existing closed bars (excluding today's synthetic bar).
  const base = cur.length ? cur.filter(b => b.time < todaySec) : []
  // Incoming closed bars from the data layer (server never stores today).
  const incoming = bars
    .filter(b => Math.floor(b.t / 1000) < todaySec)
    .map(toOHLC)
  if (incoming.length === 0 && base.length === 0) return
  // Union by timestamp — newer values replace equal timestamps.
  const byTime = new Map<number, OHLCBar>()
  for (const b of base) byTime.set(b.time, b)
  for (const b of incoming) byTime.set(b.time, b)
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time)
  const todayBar = todayBarFromRow(merged[merged.length - 1])
  const out = todayBar ? [...merged, todayBar] : merged
  panelBars[idxD]!.value = out
  panelMarkers[idxD]!.value = computeMarkers(out)
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
    applyToPanel('1', msg.bars)
  } else if (msg.timespan === '5min') {
    applyToPanel('5', msg.bars)
  } else if (msg.timespan === '10s') {
    applyToPanel('10s', msg.bars)
  } else if (msg.timespan === 'day') {
    applyDayHistory(msg.bars)
  }
}

// ── Live forming-candle updates (WS ticks) ────────────────────────────────────
// The live price patches the current (forming) candle's H/L/C — completed
// candles are never created here (history events handle that). When the period
// rolls over a fresh forming candle is appended for the tick-driven panels
// (1M, 5M, 10s). The D today bar is rebuilt from the row's session `day` data.
watch(currentRow, (newRow) => {
  if (!newRow || loading.value) return
  const livePrice = newRow.last
  if (!livePrice) return

  const tickSec = newRow.ts ? Math.floor(newRow.ts / 1000) : Math.floor(Date.now() / 1000)
  const todaySec = todayEtSec(tickSec)

  PANELS.forEach((panel, idx) => {
    const arr = panelBars[idx]!.value

    // D panel — today's candle comes from the row's session day {o,h,l,c}.
    if (panel.key === 'D') {
      const day = newRow.day
      if (day && day.o > 0) {
        // Indicator values are extended from the previous CLOSED daily bar (the
        // bar before today's) so the overlay lines stay live at the right edge.
        const lb = arr[arr.length - 1]
        const prev = lb && lb.time >= todaySec
          ? (arr.length > 1 ? arr[arr.length - 2] : undefined)
          : lb
        const todayBar: OHLCBar = {
          time: todaySec, open: day.o, high: day.h, low: day.l, close: livePrice,
          ...extendIndicators(prev, livePrice, newRow.vw),
        }
        if (!arr.length) {
          panelBars[idx]!.value = [todayBar]
        } else {
          if (lb!.time < todaySec) panelBars[idx]!.value = [...arr, todayBar]
          else if (lb!.time === todaySec) panelBars[idx]!.value = [...arr.slice(0, -1), todayBar]
        }
      }
      return
    }

    if (!arr.length) return
    const lb = arr[arr.length - 1]!

    let rolloverTime: number | null = null
    if (panel.key === '5')  rolloverTime = periodStartSec('5', tickSec)
    else if (panel.key === '1')  rolloverTime = periodStartSec('1', tickSec)
    else if (panel.key === '10s') rolloverTime = periodStartSec('10s', tickSec)

    if (rolloverTime !== null && rolloverTime !== 0 && lb.time < rolloverTime) {
      // Last bar is a completed candle — start a fresh forming candle for the
      // current period (only the tick-driven panels).
      if (panel.key === '1' || panel.key === '5' || panel.key === '10s') {
        const fresh: OHLCBar = {
          time: rolloverTime, open: livePrice, high: livePrice, low: livePrice, close: livePrice,
          ...extendIndicators(lb, livePrice, newRow.vw),
        }
        panelBars[idx]!.value = [...arr, fresh]
      }
    } else {
      // Last bar is the current forming candle — patch H/L/C from the live price
      // and extend the indicator values from the previous completed bar.
      const prev = arr.length > 1 ? arr[arr.length - 2] : undefined
      const patched: OHLCBar = {
        time: lb.time, open: lb.open,
        high: Math.max(lb.high, livePrice), low: Math.min(lb.low, livePrice),
        close: livePrice,
        ...extendIndicators(prev, livePrice, newRow.vw),
      }
      panelBars[idx]!.value = [...arr.slice(0, -1), patched]
    }
  })
}, { deep: false })

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
        :time-visible="panel.timeVisible"
        :show-seconds="panel.key === '10s'"
        :bars="panelBars[i]!.value"
        :markers="panelMarkers[i]!.value"
        :is-demo="false"
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
