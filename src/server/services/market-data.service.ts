import { restClient } from '@massive.com/client-js';
import { SettingsRepository } from '../database/repositories/settings-repository';
import { MarketDataRepository } from '../database/repositories/market-data-repository';
import type { BarInput } from '../database/repositories/market-data-repository';
import { decryptJsonFields } from '../utils/encryption';

interface MassiveBar {
  t?: number;  // timestamp (ms)
  o?: number;  // open
  h?: number;  // high
  l?: number;  // low
  c?: number;  // close
  v?: number;  // volume
  n?: number;  // transactions
}

interface MassiveAggResponse {
  status?: string;
  results?: MassiveBar[];
  resultsCount?: number;
  next_url?: string;
  data?: {
    results?: MassiveBar[];
    resultsCount?: number;
    status?: string;
    next_url?: string;
  };
}

interface MassiveTickerResult {
  ticker?: string;
  name?: string;
  market?: string;
  locale?: string;
  type?: string;
  active?: boolean;
}

interface MassiveTickerResponse {
  status?: string;
  results?: MassiveTickerResult[];
  data?: {
    results?: MassiveTickerResult[];
    status?: string;
  };
}

// ── Credential cache ─────────────────────────────────────────────────────────
// Avoids a SQLite read + decrypt on every API call. TTL is short so a settings
// change takes effect within 30 seconds without needing explicit invalidation.
const CREDS_TTL_MS = 30_000
let _cachedCreds: { apiKey: string; apiUrl: string } | null = null
let _credsExpiry = 0

/** Call this whenever the data-broker-details setting is saved. */
export function invalidateCredentialCache(): void {
  _cachedCreds = null
  _credsExpiry = 0
}

function getDecryptedBrokerDetails(): { apiKey: string; apiUrl: string } {
  if (_cachedCreds && Date.now() < _credsExpiry) return _cachedCreds

  const settingsRepo = new SettingsRepository();
  const raw = settingsRepo.getValue('data-broker-details');
  if (!raw) {
    throw new Error('Data broker not configured. Please set your Massive.com API key in Settings.');
  }

  const details = JSON.parse(raw);
  const decrypted = decryptJsonFields('data-broker-details', details);

  if (!decrypted.apiKey) {
    throw new Error('Massive.com API key not configured. Please set it in Settings > Data Provider.');
  }

  _cachedCreds = {
    apiKey: decrypted.apiKey as string,
    apiUrl: (decrypted.apiUrl as string) || 'https://api.massive.com',
  }
  _credsExpiry = Date.now() + CREDS_TTL_MS
  return _cachedCreds
}

function createClient() {
  const { apiKey, apiUrl } = getDecryptedBrokerDetails();
  return restClient(apiKey, apiUrl);
}

/**
 * Validate the Massive.com API connection by making a simple request.
 */
export async function validateConnection(): Promise<{ valid: boolean; message: string }> {
  try {
    const client = createClient();
    const response = await client.getStocksAggregates({
      stocksTicker: 'AAPL',
      multiplier: '1',
      timespan: 'day',
      from: '2025-01-02',
      to: '2025-01-02',
      limit: '1',
    });

    const aggResponse = response as MassiveAggResponse;
    const status = aggResponse?.status ?? aggResponse?.data?.status;
    if (status === 'OK') {
      return { valid: true, message: 'Connection successful' };
    }
    return { valid: false, message: `Unexpected response status: ${status}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { valid: false, message: `Connection failed: ${msg}` };
  }
}

function mapBar(ticker: string, timespan: string, bar: MassiveBar): BarInput {
  return {
    ticker,
    timespan,
    timestamp: bar.t ?? 0,
    open: bar.o ?? 0,
    high: bar.h ?? 0,
    low: bar.l ?? 0,
    close: bar.c ?? 0,
    volume: bar.v ?? 0,
    transactions: bar.n,
  };
}

/**
 * Fetch aggregate bars from Massive.com and cache them locally.
 * Follows pagination (next_url) to retrieve all bars in the date range.
 */
export async function fetchAggregates(
  ticker: string,
  multiplier: number,
  timespan: string,
  from: string,
  to: string,
): Promise<BarInput[]> {
  const { apiKey } = getDecryptedBrokerDetails();
  const client = createClient();

  const allBars: BarInput[] = [];
  let nextUrl: string | undefined;

  // First request via client
  try {
    const response = await client.getStocksAggregates({
      stocksTicker: ticker,
      multiplier: String(multiplier),
      timespan,
      from,
      to,
      adjusted: 'true',
      sort: 'asc',
      limit: '50000',
    }) as MassiveAggResponse;

    const results = response?.results ?? response?.data?.results ?? [];
    allBars.push(...results.map((bar: MassiveBar) => mapBar(ticker, timespan, bar)));
    nextUrl = response?.next_url ?? response?.data?.next_url;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Massive.com API error for ${ticker}: ${msg}`);
  }

  // Follow pagination via next_url
  while (nextUrl) {
    try {
      const separator = nextUrl.includes('?') ? '&' : '?';
      const paginatedUrl = nextUrl.includes('apiKey')
        ? nextUrl
        : `${nextUrl}${separator}apiKey=${encodeURIComponent(apiKey)}`;
      const res = await fetch(paginatedUrl);
      if (!res.ok) break;
      const data = (await res.json()) as MassiveAggResponse;
      const results = data?.results ?? [];
      if (results.length === 0) break;
      allBars.push(...results.map((bar: MassiveBar) => mapBar(ticker, timespan, bar)));
      nextUrl = data?.next_url;
    } catch {
      break;
    }
  }

  return allBars;
}

/**
 * Fetch and cache bars, returning from cache if already present.
 */
export async function getAggregates(
  ticker: string,
  multiplier: number,
  timespan: string,
  from: string,
  to: string,
): Promise<BarInput[]> {
  const repo = new MarketDataRepository();

  // Convert date strings to timestamps for cache lookup
  const fromTs = new Date(from).getTime();
  const toTs = new Date(to).getTime();

  // Check cache first
  const cached = repo.getBars(ticker, timespan, fromTs, toTs);
  if (cached.length > 0) {
    return cached.map(row => ({
      ticker: row.Ticker,
      timespan: row.Timespan,
      timestamp: row.Timestamp,
      open: row.Open,
      high: row.High,
      low: row.Low,
      close: row.Close,
      volume: row.Volume,
      transactions: row.Transactions ?? undefined,
    }));
  }

  // Fetch from API
  const bars = await fetchAggregates(ticker, multiplier, timespan, from, to);

  // Cache the results
  if (bars.length > 0) {
    repo.upsertBars(bars);
  }

  return bars;
}

/**
 * Sync market data for multiple tickers over a date range.
 */
export async function syncMarketData(
  tickers: string[],
  from: string,
  to: string,
  timespan: string = 'minute',
): Promise<{ ticker: string; bars: number; error?: string }[]> {
  const results: { ticker: string; bars: number; error?: string }[] = [];
  const repo = new MarketDataRepository();

  for (const ticker of tickers) {
    try {
      const bars = await fetchAggregates(ticker, 1, timespan, from, to);
      if (bars.length > 0) {
        repo.upsertBars(bars);
      }
      results.push({ ticker, bars: bars.length });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push({ ticker, bars: 0, error: msg });
    }
  }

  return results;
}

/**
 * Search for tickers matching a query.
 */
export async function searchTickers(query: string): Promise<MassiveTickerResult[]> {
  const client = createClient();
  const response = await client.listTickers({
    search: query,
    active: 'true',
    market: 'stocks',
    limit: '20',
  }) as MassiveTickerResponse;

  return response?.results ?? response?.data?.results ?? [];
}

/**
 * Get the status of cached market data.
 */
export function getMarketDataStatus() {
  const repo = new MarketDataRepository();
  return {
    tickers: repo.getDataStatus(),
    totalBars: repo.getTotalBars(),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

import type { MarketDataRow } from '../database/repositories/market-data-repository';

function mapRowToBar(row: MarketDataRow): BarInput {
  return {
    ticker: row.Ticker,
    timespan: row.Timespan,
    timestamp: row.Timestamp,
    open: row.Open,
    high: row.High,
    low: row.Low,
    close: row.Close,
    volume: row.Volume,
    transactions: row.Transactions ?? undefined,
  };
}

// Calendar days to look back when doing a full daily history fetch (~400 trading days)
const DAILY_LOOKBACK_CALENDAR_DAYS = 600;

// Rolling window for 1-minute bars: 5 trading days ≈ 7 calendar days
const MINUTE_WINDOW_CALENDAR_DAYS = 7;

/**
 * Three-layer daily bar fetch:
 *   L2 → SQLite (permanent store, incremental updates to yesterday)
 *   L3 → Massive.com API (full history on first fetch; delta thereafter)
 *
 * Only stores bars up to and including yesterday (completed candles).
 * Today's live price comes from the market snapshot, not stored bars.
 */
export async function getOrSyncDailyBars(ticker: string): Promise<BarInput[]> {
  const repo = new MarketDataRepository();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const toStr = yesterday.toISOString().slice(0, 10)!;

  const latest = repo.getLatestTimestamp(ticker, 'day');

  if (latest === null) {
    // First fetch: pull full history
    const from = new Date();
    from.setDate(from.getDate() - DAILY_LOOKBACK_CALENDAR_DAYS);
    const bars = await fetchAggregates(ticker, 1, 'day', from.toISOString().slice(0, 10)!, toStr);
    if (bars.length > 0) repo.upsertBars(bars);
  } else {
    // Incremental: fetch only bars after the last stored date
    const nextDay = new Date(latest);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const fromStr = nextDay.toISOString().slice(0, 10)!;
    if (fromStr <= toStr) {
      const bars = await fetchAggregates(ticker, 1, 'day', fromStr, toStr);
      if (bars.length > 0) repo.upsertBars(bars);
    }
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAILY_LOOKBACK_CALENDAR_DAYS);
  const rows = repo.getBars(ticker, 'day', cutoff.getTime(), Date.now());
  return rows.map(mapRowToBar);
}

/**
 * Three-layer 1-minute bar fetch with rolling window:
 *   L2 → SQLite (rolling 5-trading-day window, auto-pruned)
 *   L3 → Massive.com API (full window on first fetch; delta thereafter)
 *
 * Stores all bars up to and including the current minute.
 * WS AM events append today's bars in real-time via persistMinuteBar().
 */
export async function getOrSyncMinuteBars(ticker: string): Promise<BarInput[]> {
  const repo = new MarketDataRepository();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MINUTE_WINDOW_CALENDAR_DAYS);
  const cutoffMs = cutoff.getTime();
  const fromStr = cutoff.toISOString().slice(0, 10)!;
  const toStr = new Date().toISOString().slice(0, 10)!;

  // Prune expired bars first
  repo.pruneOlderThan(ticker, 'minute', cutoffMs);

  const latest = repo.getLatestTimestamp(ticker, 'minute');

  if (latest === null || latest < cutoffMs) {
    // No data or all data expired: fetch full window
    const bars = await fetchAggregates(ticker, 1, 'minute', fromStr, toStr);
    if (bars.length > 0) repo.upsertBars(bars, 'IGNORE');
  } else {
    // Incremental: fetch only from after the latest stored bar
    const nextMinute = new Date(latest + 60_000);
    const incrementalFrom = nextMinute.toISOString().slice(0, 10)!;
    if (incrementalFrom <= toStr) {
      const bars = await fetchAggregates(ticker, 1, 'minute', incrementalFrom, toStr);
      if (bars.length > 0) repo.upsertBars(bars, 'IGNORE');
    }
  }

  const rows = repo.getBars(ticker, 'minute', cutoffMs, Date.now());
  return rows.map(mapRowToBar);
}

/**
 * Persist a single completed 1-minute bar (called from WS AM event handler).
 * Uses INSERT OR IGNORE so duplicate bars (from overlapping fetches) are silently skipped.
 */
export function persistMinuteBar(bar: BarInput): void {
  const repo = new MarketDataRepository();
  repo.upsertBars([bar], 'IGNORE');
}
