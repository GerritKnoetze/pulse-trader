import type { BarInput } from '../database/repositories/market-data-repository'

// Per-timespan cache TTL.
// Minute bars use a 15-minute TTL — long enough for chart clicks to be instant
// after a scan. WS AM ticks call appendBar() in real-time, so the data stays
// current during market hours regardless of this TTL.
const TTL_MS: Record<string, number> = {
  minute: 15 * 60_000,
  hour:   60 * 60_000,
  day:    24 * 60 * 60_000,
  week:   24 * 60 * 60_000,
  month:  24 * 60 * 60_000,
}

const MAX_ENTRIES = 2000

interface Entry {
  bars: BarInput[]
  expiresAt: number
}

class CandleCache {
  private store = new Map<string, Entry>()

  get(ticker: string, timespan: string): BarInput[] | null {
    const key = `${ticker}:${timespan}`
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null }
    return entry.bars
  }

  set(ticker: string, timespan: string, bars: BarInput[]): void {
    if (this.store.size >= MAX_ENTRIES) this.evict()
    const ttl = TTL_MS[timespan] ?? 60 * 60_000
    this.store.set(`${ticker}:${timespan}`, { bars, expiresAt: Date.now() + ttl })
  }

  /**
   * Append or update a single bar in the cache (O(1) for the common case).
   * If the last bar has the same timestamp it is replaced (in-progress bar update).
   * Otherwise the bar is appended. Creates the cache entry if it doesn't exist.
   */
  appendBar(ticker: string, timespan: string, bar: BarInput): void {
    const key = `${ticker}:${timespan}`
    const entry = this.store.get(key)
    if (!entry || Date.now() > entry.expiresAt) {
      const ttl = TTL_MS[timespan] ?? 60 * 60_000
      this.store.set(key, { bars: [bar], expiresAt: Date.now() + ttl })
      return
    }
    const last = entry.bars[entry.bars.length - 1]
    if (last && last.timestamp === bar.timestamp) {
      entry.bars[entry.bars.length - 1] = bar  // update in-progress bar
    } else {
      entry.bars.push(bar)
    }
  }

  invalidate(ticker: string, timespan?: string): void {
    if (timespan) {
      this.store.delete(`${ticker}:${timespan}`)
    } else {
      for (const k of this.store.keys()) {
        if (k.startsWith(`${ticker}:`)) this.store.delete(k)
      }
    }
  }

  get size(): number { return this.store.size }

  private evict(): void {
    const now = Date.now()
    for (const [k, e] of this.store) {
      if (e.expiresAt < now) this.store.delete(k)
    }
    if (this.store.size >= MAX_ENTRIES) {
      const sorted = [...this.store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      sorted.slice(0, 200).forEach(([k]) => this.store.delete(k))
    }
  }
}

declare global { var __candleCache: CandleCache | undefined }

export function getCandleCache(): CandleCache {
  if (!globalThis.__candleCache) globalThis.__candleCache = new CandleCache()
  return globalThis.__candleCache
}
