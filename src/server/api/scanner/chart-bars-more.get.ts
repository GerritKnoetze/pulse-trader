import { loadOlderBars } from '../../services/market-data.service'
import type { IndicatorValues } from '../../../app/utils/indicators'
import type { BarInput } from '../../database/repositories/market-data-repository'

/**
 * GET /api/scanner/chart-bars-more?symbol=AAPL&timespan=minute&before=<ms>&count=200
 *
 * Loads `count` historical bars IMMEDIATELY OLDER than the `before` timestamp for
 * one chart pane (the chart's "load more" left-edge button). Reads the range from
 * SQLite while it is inside the retention window; otherwise fetches it from the
 * provider, persists it and pushes the prune cutoff back for this chart's session
 * so re-syncs do not delete the loaded older bars. Bars are indicator-enriched
 * (exact from the first returned bar).
 */
interface ChartBar {
  t: number; o: number; h: number; l: number; c: number; v: number
  ema9?: number; ema20?: number; ema200?: number
  ema12?: number; ema26?: number
  macd?: number; macdSignal?: number; macdHist?: number
  vwap?: number
}

function toChartBars(bars: Array<BarInput & Partial<IndicatorValues>>): ChartBar[] {
  return bars.map(b => ({
    t: b.timestamp,
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
    v: b.volume,
    ema9: b.ema9, ema20: b.ema20, ema200: b.ema200,
    ema12: b.ema12, ema26: b.ema26,
    macd: b.macd, macdSignal: b.macdSignal, macdHist: b.macdHist,
    vwap: b.vwap,
  }))
}

const VALID_TIMESPANS = new Set(['day', '5min', 'minute', '10s'])

export default defineEventHandler(async (event) => {
  const { symbol, timespan, before, count } = getQuery(event) as {
    symbol?: string
    timespan?: string
    before?: string
    count?: string
  }

  const ticker = symbol?.toUpperCase()
  const beforeMs = Number(before)
  const countN = Number(count)

  if (!ticker || !timespan || !VALID_TIMESPANS.has(timespan)) {
    throw createError({ statusCode: 400, message: 'symbol and a valid timespan (day|5min|minute|10s) are required' })
  }
  if (!Number.isFinite(beforeMs) || !Number.isFinite(countN) || countN <= 0) {
    throw createError({ statusCode: 400, message: 'before (ms) and count (>0) are required' })
  }

  const { bars, hasMore } = await loadOlderBars(ticker, timespan, beforeMs, countN)

  return {
    symbol: ticker,
    timespan,
    hasMore,
    bars: toChartBars(bars.sort((a, b) => a.timestamp - b.timestamp).slice(Math.max(0, bars.length - countN))),
  }
})
