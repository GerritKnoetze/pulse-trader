import type { BarInput } from '../database/repositories/market-data-repository'
import { getMetrics } from './metrics'

// Per-timespan cache TTL.
// Intraday entries are long-lived because the scanner's freshness check (period
// elapsed vs. last bar) drives refetch — the TTL only needs to outlive a session
// so entries don't expire mid-day and trigger redundant L2/L3 reads.
const TTL_MS: Record<string, number> = {
  '10s':   5 * 60_000,
  '5min':  6 * 60 * 60_000,
  minute: 6 * 60 * 60_000,
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

export interface CandleCacheEntryInfo {
  ticker: string
  timespan: string
  count: number
  expiresAt: number
  ttlRemainingMs: number
  expired: boolean
  firstTs: number | null
  lastTs: number | null
}

class CandleCache {
  private store = new Map<string, Entry>()

  get(ticker: string, timespan: string): BarInput[] | null {
    const key = `${ticker}:${timespan}`
    const entry = this.store.get(key)
    if (!entry) { getMetrics().increment('candleL1Misses'); return null }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      getMetrics().increment('candleL1Misses')
      return null
    }
    getMetrics().increment('candleL1Hits')
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

  /** Drop every entry (full L1 candle-cache flush). */
  clear(): void { this.store.clear() }

  get size(): number { return this.store.size }

  /** Total number of bars held across all cache entries. */
  get totalBars(): number {
    let total = 0
    for (const entry of this.store.values()) total += entry.bars.length
    return total
  }

  /**
   * Inspect every entry (including expired ones) without mutating the cache.
   * Used by the data-management view to show what's in memory right now.
   */
  inspect(): CandleCacheEntryInfo[] {
    const now = Date.now()
    const out: CandleCacheEntryInfo[] = []
    for (const [key, entry] of this.store) {
      const sep = key.lastIndexOf(':')
      const ticker = key.slice(0, sep)
      const timespan = key.slice(sep + 1)
      out.push({
        ticker,
        timespan,
        count: entry.bars.length,
        expiresAt: entry.expiresAt,
        ttlRemainingMs: Math.max(0, entry.expiresAt - now),
        expired: now > entry.expiresAt,
        firstTs: entry.bars[0]?.timestamp ?? null,
        lastTs: entry.bars[entry.bars.length - 1]?.timestamp ?? null,
      })
    }
    out.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.timespan.localeCompare(b.timespan))
    return out
  }

  /** Read the raw bar array for a key without expiry checks (for inspection/export). */
  peek(ticker: string, timespan: string): BarInput[] | null {
    return this.store.get(`${ticker}:${timespan}`)?.bars ?? null
  }

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
