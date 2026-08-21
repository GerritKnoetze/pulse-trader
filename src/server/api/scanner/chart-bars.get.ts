/**
 * GET /api/scanner/chart-bars?symbol=AAPL
 *
 * Returns multi-timeframe OHLC bars for the 4-panel chart:
 *   D   (daily)
 *   W   (weekly — derived from daily)
 *   M   (monthly — derived from daily)
 *   1   (1-minute)
 *   5   (5-minute)
 *   10s (10-second — empty until WS-derived)
 *   60  / 30  (derived from 1-minute)
 *
 * The read path is CACHE/DB-ONLY — it NEVER blocks on the network:
 *   L1 CandleCache → L2 SQLite read → (empty) return what exists.
 * A missing/stale series is backfilled in the BACKGROUND via
 * scanner-engine.seedSymbolBars() and the fresh bars are pushed to this
 * client over the open SSE channel as `bars` events — the chart fills
 * within seconds without the request waiting on Massive.com.
 *
 * Each bar: { t: number (ms), o, h, l, c, v }
 */
import {
  readCachedBars,
  getIntradayWindowDays,
  getDailyLookbackDays,
} from '../../services/market-data.service'
import {
  aggregateToWeekly,
  aggregateToMonthly,
  aggregateTo30min,
  aggregateTo60min,
  aggregateTo5min,
} from '../../services/ta-calculator'
import type { BarInput } from '../../database/repositories/market-data-repository'
import { getCandleCache } from '../../services/candle-cache'
import { getScannerEngine } from '../../services/scanner-engine'

interface ChartBar { t: number; o: number; h: number; l: number; c: number; v: number }

// Daily lookback matches market-data.service getDailyLookbackDays()
// (user setting `daily-lookback-calendar-days`, default 600 calendar days →
// supports 200 EMA / MACD warm-up on the daily panel + weekly/monthly aggregation).
const DAY_LOOKBACK_MS = () => getDailyLookbackDays() * 86_400_000
// Intraday window matches market-data.service getIntradayWindowDays()
// (user setting `intraday-window-calendar-days`, default 60 calendar days ≈
// 273 hourly bars → 200 EMA on 60-min + MACD warm-up).
const WINDOW_LOOKBACK_MS = () => getIntradayWindowDays() * 86_400_000

function toChartBars(bars: BarInput[]): ChartBar[] {
  return bars.map(b => ({
    t: b.timestamp,
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
    v: b.volume,
  }))
}

/** L1 cache → L2 SQLite. Never touches the network (background seed does). */
function loadSeries(ticker: string, timespan: string, from: number, to: number): BarInput[] {
  const cached = getCandleCache().get(ticker, timespan)
  if (cached && cached.length > 0) return cached
  return readCachedBars(ticker, timespan, from, to)
}

export default defineEventHandler((event) => {
  const { symbol } = getQuery(event) as { symbol?: string }
  if (!symbol) throw createError({ statusCode: 400, message: 'symbol is required' })

  const ticker = symbol.toUpperCase()
  const now = Date.now()

  // ── Daily (and derived W/M) + 1-min (and derived 60/30) — in parallel so a
  //  cold-cache symbol isn't serialized (and doesn't stall during a grid load). ──
  const dailyBars   = loadSeries(ticker, 'day', now - DAY_LOOKBACK_MS(), now)
  const minuteBars  = loadSeries(ticker, 'minute', now - WINDOW_LOOKBACK_MS(), now)
  const daily   = toChartBars(dailyBars)
  const weekly  = toChartBars(aggregateToWeekly(dailyBars))
  const monthly = toChartBars(aggregateToMonthly(dailyBars))
  const min1  = toChartBars(minuteBars)
  const min60 = toChartBars(aggregateTo60min(minuteBars))
  const min30 = toChartBars(aggregateTo30min(minuteBars))

  // ── 5-min: cache → DB → derive from 1-min (no API call needed) ──
  let fiveMin: ChartBar[] = []
  const cached5 = getCandleCache().get(ticker, '5min')
  if (cached5 && cached5.length > 0) {
    fiveMin = toChartBars(cached5)
  } else {
    const db5 = readCachedBars(ticker, '5min', now - WINDOW_LOOKBACK_MS(), now)
    if (db5.length > 0) {
      fiveMin = toChartBars(db5)
    } else if (minuteBars.length > 0) {
      fiveMin = toChartBars(aggregateTo5min(minuteBars))
    }
  }

  // ── 10-second bars ──────────────────────────────────────────────────────────
  // Read the in-memory buffer INSTANTLY (the engine seeds history in the
  // background and pushes it via SSE — see seedSymbolBars).
  let sec10: ChartBar[] = []
  try { sec10 = toChartBars(getCandleCache().get(ticker, '10s') ?? []) } catch { /* empty */ }

  // Backfill any missing/stale series in the background — the result streams
  // to this client over SSE as `bars` events. Cheap no-op for warm symbols
  // (per-symbol in-flight dedup + freshness gates prevent redundant fetches).
  getScannerEngine().seedSymbolBars(ticker)

  return {
    symbol: ticker,
    bars: {
      D:    daily,
      W:    weekly,
      M:    monthly,
      '1':  min1,
      '5':  fiveMin,
      '10s': sec10,
      '60': min60,
      '30': min30,
    },
  }
})
