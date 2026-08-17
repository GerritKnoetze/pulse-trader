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
 *
 * Load order is CACHE-FIRST so opens never block on the network when data
 * already exists: L1 CandleCache → L2 SQLite read → L3 API only as a last
 * resort (no stored data at all).
 *
 * After the initial load the chart is kept current by event-driven SSE bar
 * updates pushed from the data layer — it never polls this endpoint again.
 *
 * Each bar: { t: number (ms), o, h, l, c, v }
 */
import {
  getOrSyncDailyBars,
  getOrSyncMinuteBars,
  getOrSyncFiveMinuteBars,
  readCachedBars,
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

interface ChartBar { t: number; o: number; h: number; l: number; c: number; v: number }

const DAY_LOOKBACK_MS    = 600 * 86_400_000
const WINDOW_LOOKBACK_MS = 7 * 86_400_000

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

/** cache → SQLite read → API (last resort). Returns bars and whether they were cached. */
async function loadSeries(
  ticker: string,
  timespan: string,
  from: number,
  to: number,
  sync: () => Promise<BarInput[]>,
): Promise<BarInput[]> {
  const cached = getCandleCache().get(ticker, timespan)
  if (cached && cached.length > 0) return cached

  const fromDb = readCachedBars(ticker, timespan, from, to)
  if (fromDb.length > 0) return fromDb

  // No data anywhere — allow a network fetch (bounded by fetchAggregates timeout).
  try {
    const bars = await sync()
    if (bars.length > 0) getCandleCache().set(ticker, timespan, bars)
    return bars
  } catch {
    return []
  }
}

export default defineEventHandler(async (event) => {
  const { symbol } = getQuery(event) as { symbol?: string }
  if (!symbol) throw createError({ statusCode: 400, message: 'symbol is required' })

  const ticker = symbol.toUpperCase()
  const now = Date.now()

  // ── Daily (and derived W/M) + 1-min (and derived 60/30) — in parallel so a
  //  cold-cache fetch isn't serialized (and doesn't stall during a grid load). ──
  const [dailyBars, minuteBars] = await Promise.all([
    loadSeries(ticker, 'day', now - DAY_LOOKBACK_MS, now, () => getOrSyncDailyBars(ticker)),
    loadSeries(ticker, 'minute', now - WINDOW_LOOKBACK_MS, now, () => getOrSyncMinuteBars(ticker)),
  ])
  const daily   = toChartBars(dailyBars)
  const weekly  = toChartBars(aggregateToWeekly(dailyBars))
  const monthly = toChartBars(aggregateToMonthly(dailyBars))
  const min1  = toChartBars(minuteBars)
  const min60 = toChartBars(aggregateTo60min(minuteBars))
  const min30 = toChartBars(aggregateTo30min(minuteBars))

  // ── 5-min: cache → DB → derive from 1-min → API (last resort, fast race) ──
  let fiveMin: ChartBar[] = []
  const cached5 = getCandleCache().get(ticker, '5min')
  if (cached5 && cached5.length > 0) {
    fiveMin = toChartBars(cached5)
  } else {
    const db5 = readCachedBars(ticker, '5min', now - WINDOW_LOOKBACK_MS, now)
    if (db5.length > 0) {
      fiveMin = toChartBars(db5)
    } else if (minuteBars.length > 0) {
      // Derive from 1-min — no API call.
      fiveMin = toChartBars(aggregateTo5min(minuteBars))
    } else {
      const fiveMinPromise = Promise.race([
        getOrSyncFiveMinuteBars(ticker),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('5m fetch timeout')), 3_000)),
      ])
      try { fiveMin = toChartBars(await fiveMinPromise) } catch { /* empty */ }
    }
  }

  // ── 10-second bars ──────────────────────────────────────────────────────────
  // Read the in-memory buffer INSTANTLY (never block the chart open on the 10s
  // REST seed — the engine seeds history in the background and pushes it via SSE).
  let sec10: ChartBar[] = []
  try { sec10 = toChartBars(getCandleCache().get(ticker, '10s') ?? []) } catch { /* empty */ }

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
