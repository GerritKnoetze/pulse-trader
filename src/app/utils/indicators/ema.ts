/**
 * EMA (Exponential Moving Average) overlay.
 * Standard SMA-seeded EMA: k = 2 / (period + 1).
 */

export const EMA_WINDOWS = [9, 20, 200] as const

export function emaOf(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length === 0) return out
  // Warm-up fill: a running SMA so the line starts at bar 0 instead of gapping
  // for the first `period` bars. It hands off smoothly — the SMA at index
  // period-1 equals the EMA seed, so the curve is continuous.
  let runSum = 0
  for (let i = 0; i < closes.length; i++) {
    runSum += closes[i]!
    out[i] = runSum / (i + 1)
  }
  if (closes.length < period) return out
  let seedSum = 0
  for (let i = 0; i < period; i++) seedSum += closes[i]!
  let prev = seedSum / period
  out[period - 1] = prev
  const k = 2 / (period + 1)
  for (let i = period; i < closes.length; i++) {
    prev = (closes[i]! - prev) * k + prev
    out[i] = prev
  }
  return out
}

/** O(1) live extension of an EMA with a new close (used for the forming candle). */
export function emaUpdate(prev: number, close: number, period: number): number {
  return (close - prev) * (2 / (period + 1)) + prev
}
