/**
 * Metrics — lightweight in-memory counters for the data layer.
 *
 * Tracks cache hit/miss rates, fetch counts/latencies, scan timings and
 * error/gap counts so the scan and live paths can be validated end-to-end.
 * Exposed via /api/scanner/status and the scan log lines.
 */

interface CounterSet {
  // L1 in-memory cache
  candleL1Hits: number
  candleL1Misses: number
  // L2 SQLite
  sqliteReads: number
  sqliteWrites: number
  // L3 upstream
  restFetches: number
  restPageFetches: number
  restErrors: number
  restRateLimited: number
  restGaps: number
  // snapshot
  snapshotFetches: number
  snapshotServedStale: number
  // scans
  scans: number
  scanEnrichedRows: number
  scanProgressiveRows: number
  // live
  wsTicks: number
  wsReconnects: number
}

const initial: CounterSet = {
  candleL1Hits: 0,
  candleL1Misses: 0,
  sqliteReads: 0,
  sqliteWrites: 0,
  restFetches: 0,
  restPageFetches: 0,
  restErrors: 0,
  restRateLimited: 0,
  restGaps: 0,
  snapshotFetches: 0,
  snapshotServedStale: 0,
  scans: 0,
  scanEnrichedRows: 0,
  scanProgressiveRows: 0,
  wsTicks: 0,
  wsReconnects: 0,
}

interface CounterTotals {
  candleL1HitRate: number
  snapshotFetches: number
  snapshotServedStale: number
  scans: number
  restFetches: number
  restErrors: number
  restRateLimited: number
  restGaps: number
  restPageFetches: number
  wsTicks: number
  wsReconnects: number
}

class Metrics {
  private counters: CounterSet = { ...initial }

  increment<K extends keyof CounterSet>(key: K, by = 1): void {
    this.counters[key] = (this.counters[key] as number) + by
  }

  get snapshot(): CounterTotals {
    const c = this.counters
    const total = c.candleL1Hits + c.candleL1Misses
    return {
      candleL1HitRate: total > 0 ? Math.round((c.candleL1Hits / total) * 1000) / 10 : 0,
      snapshotFetches: c.snapshotFetches,
      snapshotServedStale: c.snapshotServedStale,
      scans: c.scans,
      restFetches: c.restFetches,
      restErrors: c.restErrors,
      restRateLimited: c.restRateLimited,
      restGaps: c.restGaps,
      restPageFetches: c.restPageFetches,
      wsTicks: c.wsTicks,
      wsReconnects: c.wsReconnects,
    }
  }

  get raw(): CounterSet { return { ...this.counters } }

  reset(): void { this.counters = { ...initial } }
}

declare global { var __metrics: Metrics | undefined }

export function getMetrics(): Metrics {
  if (!globalThis.__metrics) globalThis.__metrics = new Metrics()
  return globalThis.__metrics
}
