/**
 * MACD (Moving Average Convergence/Divergence) overlay — 12/26/9.
 * macd = EMA(short) − EMA(long); signal = EMA(signal) of macd; hist = macd − signal.
 */
import { emaOf, emaUpdate } from './ema'

export const MACD_CONFIG = { short: 12, long: 26, signal: 9 } as const

export interface MacdSeries {
  macd: (number | null)[]
  signal: (number | null)[]
  hist: (number | null)[]
  ema12: (number | null)[]
  ema26: (number | null)[]
}

export interface MacdState {
  ema12?: number
  ema26?: number
  signal?: number
}

/** EMA over a series that may contain nulls (used for the signal line). */
function emaSeries(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  const valid: number[] = []
  const idx: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (values[i] != null) { valid.push(values[i]!); idx.push(i) }
  }
  if (valid.length === 0) return out
  // Warm-up fill (running SMA) so the signal line starts at the first value.
  let runSum = 0
  for (let i = 0; i < valid.length; i++) {
    runSum += valid[i]!
    out[idx[i]!] = runSum / (i + 1)
  }
  if (valid.length < period) return out
  let seedSum = 0
  for (let i = 0; i < period; i++) seedSum += valid[i]!
  let prev = seedSum / period
  out[idx[period - 1]!] = prev
  const k = 2 / (period + 1)
  for (let i = period; i < valid.length; i++) {
    prev = (valid[i]! - prev) * k + prev
    out[idx[i]!] = prev
  }
  return out
}

export function macdOf(closes: number[]): MacdSeries {
  const ema12 = emaOf(closes, MACD_CONFIG.short)
  const ema26 = emaOf(closes, MACD_CONFIG.long)
  const macd = closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? ema12[i]! - ema26[i]! : null)
  const signal = emaSeries(macd, MACD_CONFIG.signal)
  const hist = macd.map((m, i) =>
    m != null && signal[i] != null ? m - signal[i]! : null)
  return { macd, signal, hist, ema12, ema26 }
}

/** O(1) live extension of MACD state with a new close (forming candle). */
export function macdUpdate(
  state: MacdState,
  close: number,
): { ema12?: number; ema26?: number; macd?: number; signal?: number; hist?: number } {
  if (state.ema12 == null || state.ema26 == null) return {}
  const ema12 = emaUpdate(state.ema12, close, MACD_CONFIG.short)
  const ema26 = emaUpdate(state.ema26, close, MACD_CONFIG.long)
  const macd = ema12 - ema26
  const k = 2 / (MACD_CONFIG.signal + 1)
  const signal = state.signal != null ? macd * k + state.signal * (1 - k) : undefined
  const hist = signal != null ? macd - signal : undefined
  return { ema12, ema26, macd, signal, hist }
}
