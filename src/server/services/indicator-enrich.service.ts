/**
 * Indicator enrichment — EXTENDED-history compute + trim.
 *
 * EMA(9/20/200) + MACD(12/26/9) need `EMA_WARMUP_BARS` prior bars before a
 * value is exact. The data layer keeps window + warm-up context in SQLite
 * (L1→L2→L3: CandleCache/DB filled from the Massive API), but only the DISPLAY
 * window hits the client. This module prepends the warm-up context from L2 and
 * computes the indicators over the extended series, then trims the warm-up so
 * every returned bar is exact from the first visible bar — no left-edge gap and
 * no running-SMA ramp.
 */
import { readCachedBars, warmupMs } from './market-data.service'
import {
  attachIndicators,
  attachIndicatorsTrimmed,
  type IndicatorValues,
  type OHLCOverlayInput,
} from '../../app/utils/indicators'
import type { BarInput } from '../database/repositories/market-data-repository'

const tsOf = (b: { timestamp?: number; time?: number }): number =>
  b.timestamp ?? (b.time ?? 0) * 1000

/**
 * Hard ceiling on the number of bars sent to a chart panel. intraday series are
 * long (60 dense trading days of 1-minute bars ≈ 23k bars), and the client
 * copies the panel array on every WS tick to patch the live forming candle —
 * a 23k-element array rebuild per tick is what froze the UI. The indicator
 * values are computed over the FULL extended history (so they stay exact); we
 * only cap the number of bars the chart holds/renders, which is far more than
 * the ~150 visible. Older bars scroll out harmlessly.
 */
export const MAX_CHART_BARS = 3000

function cap<T>(bars: T[]): T[] {
  return bars.length > MAX_CHART_BARS ? bars.slice(-MAX_CHART_BARS) : bars
}

/**
 * Attach exact EMA/MACD values to `displayBars`, seeded with warm-up context
 * read from L2 (SQLite) just before the display window. The warm-up bars are
 * used only for computation and are trimmed from the returned series. The
 * result is capped to MAX_CHART_BARS (newest kept) so per-tick client work stays
 * bounded while indicator accuracy is preserved.
 */
export function enrichIndicatorSeries<T extends OHLCOverlayInput>(
  ticker: string,
  timespan: string,
  displayBars: T[],
): (T & IndicatorValues)[] {
  if (displayBars.length === 0) return []

  const displayCount = displayBars.length
  const firstTs = tsOf(displayBars[0]!)
  const warmupFrom = firstTs - warmupMs(timespan)

  // L2: warm-up context (older than the display window). Empty on a cold
  // series — attachIndicators' running-SMA seed still produces a continuous
  // line (a later refresh fills context once the data layer has synced it).
  const warmup = readCachedBars(ticker, timespan, warmupFrom, firstTs) as T[]
  if (warmup.length === 0) return cap(attachIndicators(displayBars))

  const extended = [...warmup, ...displayBars].sort((a, b) => tsOf(a) - tsOf(b))
  return cap(attachIndicatorsTrimmed(extended, displayCount))
}

/** Convenience: enrich a cached/derived BarInput series, forwarding to chart bars. */
export function enrichBarSeries(
  ticker: string,
  timespan: string,
  displayBars: BarInput[],
): (BarInput & IndicatorValues)[] {
  return enrichIndicatorSeries<BarInput>(ticker, timespan, displayBars)
}
