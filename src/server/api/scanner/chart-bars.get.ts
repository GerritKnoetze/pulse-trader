/**
 * GET /api/scanner/chart-bars?symbol=AAPL
 *
 * Returns multi-timeframe OHLC bars for the 4-panel chart:
 *   D   (daily)
 *   W   (weekly — derived from daily)
 *   M   (monthly — derived from daily)
 *   30  (30-minute — derived from 1-min)
 *   5   (5-minute — derived from 1-min)
 *
 * Each bar: { t: number (ms), o, h, l, c, v }
 */
import { getOrSyncDailyBars, getOrSyncMinuteBars } from '../../services/market-data.service'
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

export default defineEventHandler(async (event) => {
  const { symbol } = getQuery(event) as { symbol?: string }
  if (!symbol) throw createError({ statusCode: 400, message: 'symbol is required' })

  const ticker = symbol.toUpperCase()

  // ── Daily (and derived W/M) ───────────────────────────────────────────────
  let dailyBars: BarInput[] = []
  try {
    dailyBars = await getOrSyncDailyBars(ticker)
  } catch {
    // Return what we have even if API fails — chart will show empty panels
  }

  const daily   = toChartBars(dailyBars)
  const weekly  = toChartBars(aggregateToWeekly(dailyBars))
  const monthly = toChartBars(aggregateToMonthly(dailyBars))

  // ── Intraday (1-min cache → 30-min, 5-min) ───────────────────────────────
  let minuteBars: BarInput[] = []
  try {
    const cached = getCandleCache().get(ticker, 'minute')
    if (cached && cached.length > 0) {
      minuteBars = cached
    } else {
      minuteBars = await getOrSyncMinuteBars(ticker)
      if (minuteBars.length > 0) getCandleCache().set(ticker, 'minute', minuteBars)
    }
  } catch {
    // Intraday is optional
  }

  const min60 = toChartBars(aggregateTo60min(minuteBars))
  const min30 = toChartBars(aggregateTo30min(minuteBars))
  const min5  = toChartBars(aggregateTo5min(minuteBars))

  return {
    symbol: ticker,
    bars: {
      D:    daily,
      W:    weekly,
      M:    monthly,
      '60': min60,
      '30': min30,
      '5':  min5,
    },
  }
})
