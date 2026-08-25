/**
 * Indicator overlays — the data service attaches computed indicator values to
 * every OHLCV bar (from the L1→L2→L3 candle series, warmed up with extended
 * history so EMA(200)/MACD are exact from the first bar). The chart reads them
 * off each bar and renders the enabled overlays. This module also provides the
 * O(1) live extension used to keep the forming candle's indicator values
 * current from the live tape.
 *
 * Each indicator lives in its own file: ema.ts / macd.ts / vwap.ts / volume.ts.
 */
import { emaOf, emaUpdate } from './ema'
import { macdOf, macdUpdate, type MacdState } from './macd'
import { vwapOf, etDayKeyMs, type VwapInput } from './vwap'

export { emaOf, emaUpdate, EMA_WINDOWS } from './ema'
export { macdOf, macdUpdate, MACD_CONFIG, type MacdSeries, type MacdState } from './macd'
export { vwapOf, etDayKeyMs, type VwapInput } from './vwap'
export { volumesOf, maxVolume, type VolumeInput } from './volume'

/**
 * Warm-up bar count. The longest EMA we compute is EMA(200), so computing a
 * series needs at least 200 preceding bars for the value at bar 0 to be exact
 * (the SMA seed only kicks in below this). Callers fetch `display + this many`
 * bars and trim the warm-up so every returned bar is computed with full history.
 */
export const EMA_WARMUP_BARS = 200

export type OverlayId = 'ema9' | 'ema20' | 'ema200' | 'vwap' | 'volume' | 'macd'

/** Metadata for the toggleable overlay buttons (chart header) + rendering. */
export interface OverlayMeta {
  id: OverlayId
  label: string
  color: string
}

export const OVERLAY_META: OverlayMeta[] = [
  { id: 'vwap',   label: 'VWAP',  color: '#ff9800' },
  { id: 'ema9',   label: 'EMA9',  color: '#ffffff' },
  { id: 'ema20',  label: 'EMA20', color: '#2196f3' },
  { id: 'ema200', label: 'EMA200',color: '#ab47bc' },
  { id: 'volume', label: 'VOL',   color: '#787b86' },
  { id: 'macd',   label: 'MACD',  color: '#2962ff' },
]

/** Indicator values attached to a bar (all aligned to the bar index). */
export interface IndicatorValues {
  ema9?: number
  ema20?: number
  ema200?: number
  ema12?: number
  ema26?: number
  macd?: number
  macdSignal?: number
  macdHist?: number
  vwap?: number
}

/** Minimal OHLCV shape attachIndicators can consume (server + client bars). */
export interface OHLCOverlayInput {
  timestamp?: number
  time?: number
  high: number
  low: number
  close: number
  volume?: number
  vwap?: number
}

/**
 * Compute EMA/MACD/VWAP over a full series and attach the values to each bar.
 * VWAP is the CALCULATED per-ET-day cumulative VWAP (Σ typical price × volume /
 * Σ volume) anchored from the session/day open — the classic VWAP overlay line.
 * The aggregate's own `vw` is only a fallback when the computed value is null
 * (e.g. the very first bar of a series with no volume yet). Volume is never
 * computed — it comes straight from the aggregates `v` field.
 *
 * NOTE: the feed's per-bar `vw` is that single bar's VWAP, which on intraday
 * timeframes hugs the close (it is NOT the anchored session VWAP a trader
 * expects), so the computed line is preferred.
 */
export function attachIndicators<T extends OHLCOverlayInput>(bars: T[]): (T & IndicatorValues)[] {
  const closes = bars.map(b => b.close)
  const e9 = emaOf(closes, 9)
  const e20 = emaOf(closes, 20)
  const e200 = emaOf(closes, 200)
  const macd = macdOf(closes)
  const dayKeys = bars.map(b => etDayKeyMs(b.timestamp ?? (b.time ?? 0) * 1000))
  const vwComputed = vwapOf(bars as VwapInput[], dayKeys)
  return bars.map((b, i) => ({
    ...b,
    ema9: e9[i] ?? undefined,
    ema20: e20[i] ?? undefined,
    ema200: e200[i] ?? undefined,
    ema12: macd.ema12[i] ?? undefined,
    ema26: macd.ema26[i] ?? undefined,
    macd: macd.macd[i] ?? undefined,
    macdSignal: macd.signal[i] ?? undefined,
    macdHist: macd.hist[i] ?? undefined,
    vwap: vwComputed[i] != null ? vwComputed[i] : (b.vwap && b.vwap > 0 ? b.vwap : undefined),
  }))
}

/**
 * O(1) live indicator extension for the forming candle. `prev` is the previous
 * completed bar's indicator values; `close` is the live price. `liveVwap` is the
 * feed's own session VWAP when available (more accurate than extending bars).
 */
export function extendIndicators(
  prev: IndicatorValues | undefined,
  close: number,
  liveVwap?: number,
): IndicatorValues {
  if (!prev) return {}
  const ema9 = prev.ema9 != null ? emaUpdate(prev.ema9, close, 9) : undefined
  const ema20 = prev.ema20 != null ? emaUpdate(prev.ema20, close, 20) : undefined
  const ema200 = prev.ema200 != null ? emaUpdate(prev.ema200, close, 200) : undefined
  const m = macdUpdate({ ema12: prev.ema12, ema26: prev.ema26, signal: prev.macdSignal } as MacdState, close)
  const vwap = liveVwap && liveVwap > 0 ? liveVwap : prev.vwap
  return {
    ema9,
    ema20,
    ema200,
    ema12: m.ema12,
    ema26: m.ema26,
    macd: m.macd ?? prev.macd,
    macdSignal: m.signal ?? prev.macdSignal,
    macdHist: m.hist ?? prev.macdHist,
    vwap,
  }
}

/**
 * Attach EMA/MACD over an EXTENDED series (warm-up context + display window)
 * and TRIM the leading warm-up bars, returning only the last `displayCount`
 * bars. Every returned bar's indicator values were computed with the full
 * preceding history, so EMA(200)/MACD are exact from the first visible bar —
 * no left-edge gap and no SMA warm-up ramp.
 *
 * When the extended series is no longer than `displayCount` (no warm-up context
 * available), the whole series is returned with `attachIndicators` applied
 * (the emaOf/emaSeries running-SMA seed still guarantees a continuous line).
 */
export function attachIndicatorsTrimmed<T extends OHLCOverlayInput>(
  extended: T[],
  displayCount: number,
): (T & IndicatorValues)[] {
  if (extended.length === 0) return []
  const enriched = attachIndicators(extended)
  if (displayCount <= 0 || extended.length <= displayCount) return enriched
  return enriched.slice(-displayCount)
}
