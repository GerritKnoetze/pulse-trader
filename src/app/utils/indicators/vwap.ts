/**
 * VWAP overlay — volume-weighted average price.
 *
 * Primary source: the massive.com feed carries the official VWAP (`vw` per
 * aggregate bar, `a` session VWAP on the WS feed) so the chart plots feed
 * values when present. This file keeps the computed per-ET-day cumulative VWAP
 * (Σ typical price × volume / Σ volume) as the FALLBACK for bars that have no
 * `vw` in the store (e.g. rows written before the Vwap column existed).
 */
import { etDate } from '../data-format'

export interface VwapInput {
  high: number
  low: number
  close: number
  volume?: number
}

/** ET calendar-day key (YYYY-MM-DD) for a UTC-millisecond timestamp. */
export function etDayKeyMs(ms: number): string {
  const d = etDate(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/** Per-ET-day cumulative VWAP from typical-price × volume (computed fallback). */
export function vwapOf(bars: VwapInput[], dayKeys: string[]): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null)
  let day = ''
  let cumTypVol = 0
  let cumVol = 0
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    const d = dayKeys[i] ?? ''
    if (d !== day) { day = d; cumTypVol = 0; cumVol = 0 }
    const v = b.volume && b.volume > 0 ? b.volume : 0
    if (v > 0) {
      cumTypVol += ((b.high + b.low + b.close) / 3) * v
      cumVol += v
      out[i] = cumVol > 0 ? cumTypVol / cumVol : null
    } else {
      out[i] = i > 0 ? out[i - 1]! : null   // carry forward (e.g. forming candle)
    }
  }
  return out
}
