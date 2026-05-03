import { restClient } from '@massive.com/client-js'
import { SettingsRepository } from '../database/repositories/settings-repository'
import { decryptJsonFields } from '../utils/encryption'

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

const CACHE_TTL_MS = 60_000 // 1 minute

interface CacheData {
  tickers: SnapshotTicker[]
  fetchedAt: number
}

class SnapshotCache {
  private cache: CacheData | null = null
  private inflight: Promise<SnapshotTicker[]> | null = null

  async getSnapshot(): Promise<SnapshotTicker[]> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.tickers
    }
    if (this.inflight) return this.inflight
    this.inflight = this.fetch().finally(() => { this.inflight = null })
    return this.inflight
  }

  private async fetch(): Promise<SnapshotTicker[]> {
    const { apiKey, apiUrl } = getBrokerCredentials()
    const client = restClient(apiKey, apiUrl)
    // Call without ticker list → returns all US stock tickers; exclude OTC
    const res = await (client as any).getStocksSnapshotTickers(undefined, false) as {
      tickers?: SnapshotTicker[]
      data?: { tickers?: SnapshotTicker[] }
    }
    const tickers: SnapshotTicker[] = res?.tickers ?? res?.data?.tickers ?? []
    this.cache = { tickers, fetchedAt: Date.now() }
    return tickers
  }

  invalidate(): void { this.cache = null }
  get cachedAt(): number { return this.cache?.fetchedAt ?? 0 }
}

declare global { var __snapshotCache: SnapshotCache | undefined }

export function getSnapshotCache(): SnapshotCache {
  if (!globalThis.__snapshotCache) globalThis.__snapshotCache = new SnapshotCache()
  return globalThis.__snapshotCache
}
