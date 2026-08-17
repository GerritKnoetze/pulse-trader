import { restClient } from '@massive.com/client-js'
import { SettingsRepository } from '../database/repositories/settings-repository'
import { decryptJsonFields } from '../utils/encryption'
import { toEtDate } from '../utils/et-time'
import { getMetrics } from './metrics'

// ── Types ────────────────────────────────────────────────────────────────────

export interface SnapshotTickerDay {
  c: number   // close
  h: number   // high
  l: number   // low
  o: number   // open
  v: number   // volume
  vw: number  // vwap
}

export interface SnapshotTickerMin {
  av: number  // accumulated volume today
  c: number
  h: number
  l: number
  o: number
  v: number
  vw: number
  t: number
}

export interface SnapshotTickerLastTrade {
  p: number   // price
  s: number   // size
  t: number   // timestamp (ns)
}

export interface SnapshotTicker {
  ticker: string
  day: SnapshotTickerDay
  prevDay: SnapshotTickerDay
  lastTrade?: SnapshotTickerLastTrade
  min?: SnapshotTickerMin
  todaysChange: number
  todaysChangePerc: number
  updated: number
}

// ── Credentials helper ────────────────────────────────────────────────────────

export interface BrokerCredentials {
  apiKey: string
  apiUrl: string
  wsUrl: string
}

export function getBrokerCredentials(): BrokerCredentials {
  const repo = new SettingsRepository()
  const raw = repo.getValue('data-broker-details')
  if (!raw) throw new Error('Data broker not configured. Set API key in Settings.')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const decrypted = decryptJsonFields('data-broker-details', parsed)
  const apiKey = decrypted.apiKey as string
  if (!apiKey) throw new Error('Massive.com API key not configured.')
  return {
    apiKey,
    apiUrl: (decrypted.apiUrl as string) || 'https://api.massive.com',
    wsUrl: (decrypted.wsUrl as string) || 'wss://delayed.massive.com',
  }
}

// ── Cache ────────────────────────────────────────────────────────────────────
// TTL is market-hours aware: the snapshot changes fastest during regular hours
// and is essentially static when the market is closed.
const REGULAR_TTL_MS    = 30_000
const EXTENDED_TTL_MS   = 60_000
const CLOSED_TTL_MS     = 15 * 60_000

interface CacheData {
  tickers: SnapshotTicker[]
  fetchedAt: number
}

function sessionTtlMs(): number {
  const d = toEtDate(Date.now())
  const day = d.getUTCDay()
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  if (day === 0 || day === 6) return CLOSED_TTL_MS
  if (minutes >= 570 && minutes < 960) return REGULAR_TTL_MS   // 09:30–16:00 ET
  if (minutes >= 240 && minutes < 570) return EXTENDED_TTL_MS  // pre-market
  if (minutes >= 960 && minutes < 1200) return EXTENDED_TTL_MS // after-hours
  return CLOSED_TTL_MS
}

class SnapshotCache {
  private cache: CacheData | null = null
  private inflight: Promise<SnapshotTicker[]> | null = null

  /**
   * Get the market snapshot.
   *
   * Fresh cache  → return immediately.
   * Stale cache  → return immediately (stale-while-revalidate) and refresh in
   *                the background so scans are never blocked by the network.
   * Cold cache   → fetch (deduplicated via an in-flight promise).
   */
  async getSnapshot(): Promise<SnapshotTicker[]> {
    if (this.cache && Date.now() - this.cache.fetchedAt < sessionTtlMs()) {
      return this.cache.tickers
    }
    if (this.cache) {
      getMetrics().increment('snapshotServedStale')
      this.refreshInBackground()
      return this.cache.tickers
    }
    return this.fetchAwait()
  }

  /** Cold-cache fetch with in-flight dedup. */
  private fetchAwait(): Promise<SnapshotTicker[]> {
    if (this.inflight) return this.inflight
    this.inflight = this.fetch().finally(() => { this.inflight = null })
    return this.inflight
  }

  /** Background refresh — never awaited by callers, errors are swallowed. */
  private refreshInBackground(): void {
    if (this.inflight) return
    this.inflight = this.fetch()
      .catch(() => { /* keep serving stale on refresh failure */ })
      .finally(() => { this.inflight = null })
  }

  private async fetch(): Promise<SnapshotTicker[]> {
    const { apiKey, apiUrl } = getBrokerCredentials()
    const client = restClient(apiKey, apiUrl)
    getMetrics().increment('snapshotFetches')
    // Bounded so a stalled provider call can never hang a scan (the request
    // otherwise waits indefinitely and leaves the scan spinner stuck).
    const res = await withTimeout(
      (client as any).getStocksSnapshotTickers(undefined, false) as Promise<{
        tickers?: SnapshotTicker[]
        data?: { tickers?: SnapshotTicker[] }
      }>,
      30_000,
    )
    const tickers: SnapshotTicker[] = res?.tickers ?? res?.data?.tickers ?? []
    this.cache = { tickers, fetchedAt: Date.now() }
    return tickers
  }

  invalidate(): void { this.cache = null }
  get cachedAt(): number { return this.cache?.fetchedAt ?? 0 }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('snapshot fetch timeout')), ms),
    ),
  ])
}

declare global { var __snapshotCache: SnapshotCache | undefined }

export function getSnapshotCache(): SnapshotCache {
  if (!globalThis.__snapshotCache) globalThis.__snapshotCache = new SnapshotCache()
  return globalThis.__snapshotCache
}
