import { restClient } from '@massive.com/client-js';
import { SettingsRepository } from '../database/repositories/settings-repository';
import { MarketDataRepository } from '../database/repositories/market-data-repository';
import type { BarInput } from '../database/repositories/market-data-repository';
import { decryptJsonFields } from '../utils/encryption';
import { getMetrics } from './metrics';
import { getCandleCache } from './candle-cache';
import { daysAgoEt, todayEt, yesterdayEt } from '../utils/et-time';

// Hard ceiling for any single upstream API call — a hung Massive.com request
// must never block a scan, chart, or sync indefinitely.
const FETCH_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${FETCH_TIMEOUT_MS}ms`)), FETCH_TIMEOUT_MS);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// Per-series in-flight lock: scan enrichment, chart seeds and period refreshes
// can request the same (ticker, timespan) concurrently. This guarantees a
// single coherent upstream fetch per series — the rest await the same result —
// so the cache/DB are never written by interleaved partial fetches.
const inflightSyncs = new Map<string, Promise<unknown>>();
function dedupeSync<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflightSyncs.get(key);
  if (existing) return existing as Promise<T>;
  const p = run().finally(() => { inflightSyncs.delete(key); });
  inflightSyncs.set(key, p);
  return p;
}

/** Thrown when Massive.com rejects a request with a rate-limit (429). */
export class RateLimitError extends Error {
  constructor(ticker: string) {
    super(`Massive.com rate limit hit for ${ticker}`);
    this.name = 'RateLimitError';
  }
}

function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status ?? (err as { response?: { status?: unknown } } | null)?.response?.status;
  const msg = err instanceof Error ? err.message : String(err);
  return status === 429 || /rate\s*limit|too many requests|exceeded.*limit|429/i.test(msg);
}

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
 * Canonical app timespan for STORAGE, derived from the API (multiplier, timespan)
 * pair. The app's persistable vocabulary is 'day' | 'minute' | '5min' | '10s';
 * the API expresses 5-minute bars as (multiplier=5, timespan='minute') and
 * 10-second bars as (multiplier=10, timespan='second'). Without this mapping the
 * raw API timespan was stamped onto stored rows — 5-min bars landed in the
 * 'minute' series (corrupting boundary bars via REPLACE) and 10s bars landed in
 * 'second' (dropped by the persistable filter, so the 10s DB seed never worked).
 * Any other pair maps to the raw timespan (derived/unsupported frames are
 * filtered out by upsertBars).
 */
function toStoreTimespan(multiplier: number, timespan: string): string {
  if (timespan === 'minute') {
    if (multiplier === 1) return 'minute'
    if (multiplier === 5) return '5min'
    return timespan
  }
  if (timespan === 'second' && multiplier === 10) return '10s'
  return timespan
}

/**
 * Fetch aggregate bars from Massive.com and cache them locally.
 * Follows pagination (next_url) to retrieve all bars in the date range.
 *
 * Gap detection (gap E): any page failure, an empty page with a pending
 * next_url, or a short-fall vs the API's claimed count THROWS — a partial
 * result is never silently treated as complete.
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
  const metrics = getMetrics();

  const allBars: BarInput[] = [];
  let nextUrl: string | undefined;
  let claimedCount = 0;

  // First request via client
  let response: MassiveAggResponse;
  metrics.increment('restFetches');
  try {
    response = await withTimeout(
      client.getStocksAggregates({
        stocksTicker: ticker,
        multiplier: String(multiplier),
        timespan,
        from,
        to,
        adjusted: 'true',
        sort: 'asc',
        limit: '50000',
      }) as Promise<MassiveAggResponse>,
      `Massive.com request for ${ticker}`,
    );
  } catch (err: unknown) {
    metrics.increment('restErrors');
    if (isRateLimitError(err)) {
      metrics.increment('restRateLimited');
      throw new RateLimitError(ticker);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Massive.com API error for ${ticker}: ${msg}`);
  }

  const firstResults = response?.results ?? response?.data?.results ?? [];
  const storeTs = toStoreTimespan(multiplier, timespan);
  allBars.push(...firstResults.map((bar: MassiveBar) => mapBar(ticker, storeTs, bar)));
  claimedCount += response?.resultsCount ?? response?.data?.resultsCount ?? firstResults.length;
  nextUrl = response?.next_url ?? response?.data?.next_url;

  // Follow pagination via next_url
  while (nextUrl) {
    metrics.increment('restPageFetches');
    let data: MassiveAggResponse;
    try {
      const separator = nextUrl.includes('?') ? '&' : '?';
      const paginatedUrl = nextUrl.includes('apiKey')
        ? nextUrl
        : `${nextUrl}${separator}apiKey=${encodeURIComponent(apiKey)}`;
      const res = await withTimeout(fetch(paginatedUrl), `Massive.com pagination for ${ticker}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = (await withTimeout(res.json(), `Massive.com pagination body for ${ticker}`)) as MassiveAggResponse;
    } catch (err: unknown) {
      metrics.increment('restErrors');
      metrics.increment('restGaps');
      if (isRateLimitError(err)) {
        metrics.increment('restRateLimited');
        throw new RateLimitError(ticker);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Massive.com pagination error for ${ticker}: ${msg}`);
    }

    const results = data?.results ?? [];
    if (results.length === 0) {
      // Server advertised a next_url but returned an empty page → incomplete.
      metrics.increment('restErrors');
      metrics.increment('restGaps');
      throw new Error(`Massive.com returned an empty page for ${ticker} — data may be incomplete`);
    }
    allBars.push(...results.map((bar: MassiveBar) => mapBar(ticker, storeTs, bar)));
    claimedCount += data?.resultsCount ?? results.length;
    nextUrl = data?.next_url;
  }

  // Integrity: the API claimed more bars across pages than we received.
  if (claimedCount > allBars.length) {
    metrics.increment('restGaps');
    throw new Error(
      `Massive.com fetch for ${ticker} incomplete (claimed ${claimedCount} bars, received ${allBars.length})`,
    );
  }

  return allBars;
}

/**
 * Fetch and cache bars, returning from cache if the stored range fully covers
 * the requested [from, to] window (gap D). A partial cache is never returned
 * as complete — missing coverage is backfilled from the API first.
 */
export async function getAggregates(
  ticker: string,
  multiplier: number,
  timespan: string,
  from: string,
  to: string,
): Promise<BarInput[]> {
  const repo = new MarketDataRepository();
  // Storage uses the canonical app timespan (e.g. 5-min → '5min', 10s → '10s'),
  // while the API may express it as (multiplier=5, 'minute') / (10, 'second').
  const storeTs = toStoreTimespan(multiplier, timespan);

  // Convert date strings to timestamps for cache lookup
  const fromTs = new Date(from).getTime();
  const toTs = new Date(to).getTime();

  const range = repo.getAvailableRange(ticker, storeTs);
  const covers =
    range.count > 0
    && range.min !== null && range.min <= fromTs
    && range.max !== null && range.max >= toTs;

  if (!covers) {
    // Backfill the missing range so the returned slice is complete.
    const bars = await fetchAggregates(ticker, multiplier, timespan, from, to);
    if (bars.length > 0) repo.upsertBars(bars);
  }

  const rows = repo.getBars(ticker, storeTs, fromTs, toTs);
  return rows.map(row => ({
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

/**
 * Read bars directly from SQLite WITHOUT any upstream API call. Returns [] when
 * nothing is stored for the range — callers decide whether to fall back to L3.
 * Used by the chart path so opens never block on the network when data exists.
 */
export function readCachedBars(ticker: string, timespan: string, from: number, to: number): BarInput[] {
  const repo = new MarketDataRepository();
  const rows = repo.getBars(ticker, timespan, from, to);
  return rows.map(mapRowToBar);
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

// Rolling window for intraday bars (1-minute and 5-minute). Sized for the
// longest indicator the charts need: a 200 EMA on the 60-min panel requires
// ~200 hourly bars ≈ 31 trading days ≈ 44 calendar days. 60 calendar days
// (~42 trading days ≈ 273 hourly bars) gives that plus MACD warm-up margin.
const INTRADAY_WINDOW_CALENDAR_DAYS = 60;

// 10-second bars: look back ~70 minutes on a cold fetch (≈420 bars — enough to
// seed a 200 EMA with context) and prune SQLite rows older than ~2 hours.
const TEN_SEC_LOOKBACK_MS = 70 * 60_000;
const TEN_SEC_PRUNE_MS    = 2 * 60 * 60_000;
/** Maximum 10s bars kept per symbol in the in-memory buffer (~75 min). */
export const TEN_SEC_BUFFER = 450;

/**
 * Three-layer daily bar fetch:
 *   L2 → SQLite (permanent store, incremental updates to yesterday)
 *   L3 → Massive.com API (full history on first fetch; delta thereafter)
 *
 * Only stores bars up to and including yesterday (completed candles).
 * Today's live price comes from the market snapshot, not stored bars.
 * Date windows are computed in US Eastern time (gap J) so the session
 * boundary never drifts near midnight.
 */
export async function getOrSyncDailyBars(ticker: string): Promise<BarInput[]> {
  return dedupeSync(`${ticker}:day`, async () => {
  const repo = new MarketDataRepository();

  const toStr = yesterdayEt();
  const latest = repo.getLatestTimestamp(ticker, 'day');

  try {
    if (latest === null) {
      // First fetch: pull full history
      const from = daysAgoEt(DAILY_LOOKBACK_CALENDAR_DAYS);
      const bars = await fetchAggregates(ticker, 1, 'day', from, toStr);
      if (bars.length > 0) {
        repo.upsertBars(bars);
        repo.updateSyncState(ticker, 'day', { latestTimestamp: bars[bars.length - 1]!.timestamp });
      }
    } else {
      // Incremental: fetch only bars after the last stored date
      const nextDay = new Date(latest);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const fromStr = nextDay.toISOString().slice(0, 10)!;
      if (fromStr <= toStr) {
        const bars = await fetchAggregates(ticker, 1, 'day', fromStr, toStr);
        if (bars.length > 0) {
          repo.upsertBars(bars);
          repo.updateSyncState(ticker, 'day', { latestTimestamp: bars[bars.length - 1]!.timestamp });
        } else {
          repo.updateSyncState(ticker, 'day', { latestTimestamp: latest });
        }
      } else {
        repo.updateSyncState(ticker, 'day', { latestTimestamp: latest });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    repo.updateSyncState(ticker, 'day', { latestTimestamp: latest ?? 0, syncError: msg });
    throw err;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAILY_LOOKBACK_CALENDAR_DAYS);
  const rows = repo.getBars(ticker, 'day', cutoff.getTime(), Date.now());
  return rows.map(mapRowToBar);
  });
}

/**
 * Three-layer 1-minute bar fetch with rolling window:
 *   L2 → SQLite (rolling intraday window, auto-pruned)
 *   L3 → Massive.com API (full window on first fetch; delta thereafter)
 *
 * Stores all bars up to and including the current minute.
 * WS AM events append today's bars in real-time via persistMinuteBar().
 * The incremental delta is fetched by TIMESTAMP precision (gap C) so a warm
 * sync never re-fetches the entire day containing the latest bar.
 */
export async function getOrSyncMinuteBars(ticker: string): Promise<BarInput[]> {
  return dedupeSync(`${ticker}:minute`, async () => {
  const repo = new MarketDataRepository();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - INTRADAY_WINDOW_CALENDAR_DAYS);
  const cutoffMs = cutoff.getTime();

  // Prune expired bars first
  repo.pruneOlderThan(ticker, 'minute', cutoffMs);

  const latest = repo.getLatestTimestamp(ticker, 'minute');

  try {
    if (latest === null || latest < cutoffMs) {
      // No data or all data expired: fetch full window (date precision is fine here)
      const fromStr = daysAgoEt(INTRADAY_WINDOW_CALENDAR_DAYS);
      const toStr = todayEt();
      const bars = await fetchAggregates(ticker, 1, 'minute', fromStr, toStr);
      if (bars.length > 0) {
        repo.upsertBars(bars, 'IGNORE');
        repo.updateSyncState(ticker, 'minute', { latestTimestamp: bars[bars.length - 1]!.timestamp });
      }
    } else {
      // Incremental: fetch from the next minute after the latest stored bar.
      // Passed as a Unix-ms timestamp so the API starts exactly there instead
      // of re-returning the whole day (the previous date-string truncation).
      const incrementalFrom = latest + 60_000;
      if (incrementalFrom <= Date.now()) {
        const bars = await fetchAggregates(ticker, 1, 'minute', String(incrementalFrom), String(Date.now()));
        if (bars.length > 0) {
          repo.upsertBars(bars, 'IGNORE');
          repo.updateSyncState(ticker, 'minute', { latestTimestamp: bars[bars.length - 1]!.timestamp });
        } else {
          repo.updateSyncState(ticker, 'minute', { latestTimestamp: latest });
        }
      } else {
        repo.updateSyncState(ticker, 'minute', { latestTimestamp: latest });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    repo.updateSyncState(ticker, 'minute', { latestTimestamp: latest ?? 0, syncError: msg });
    throw err;
  }

  const rows = repo.getBars(ticker, 'minute', cutoffMs, Date.now());
  return rows.map(mapRowToBar);
  });
}

/**
 * Three-layer 5-minute bar fetch with rolling window — a REAL series fetched
 * from the API (not derived), persisted to SQLite. Incremental delta by
 * timestamp precision so each new 5-minute candle is picked up as its period
 * elapses. REPLACE keeps the in-progress bucket current.
 */
export async function getOrSyncFiveMinuteBars(ticker: string): Promise<BarInput[]> {
  return dedupeSync(`${ticker}:5min`, async () => {
  const repo = new MarketDataRepository();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - INTRADAY_WINDOW_CALENDAR_DAYS);
  const cutoffMs = cutoff.getTime();

  repo.pruneOlderThan(ticker, '5min', cutoffMs);

  const latest = repo.getLatestTimestamp(ticker, '5min');

  try {
    if (latest === null || latest < cutoffMs) {
      const fromStr = daysAgoEt(INTRADAY_WINDOW_CALENDAR_DAYS);
      const toStr = todayEt();
      const bars = await fetchAggregates(ticker, 5, 'minute', fromStr, toStr);
      if (bars.length > 0) {
        repo.upsertBars(bars, 'REPLACE');
        repo.updateSyncState(ticker, '5min', { latestTimestamp: bars[bars.length - 1]!.timestamp });
      }
    } else {
      const incrementalFrom = latest + 5 * 60_000;
      if (incrementalFrom <= Date.now()) {
        const bars = await fetchAggregates(ticker, 5, 'minute', String(incrementalFrom), String(Date.now()));
        if (bars.length > 0) {
          repo.upsertBars(bars, 'REPLACE');
          repo.updateSyncState(ticker, '5min', { latestTimestamp: bars[bars.length - 1]!.timestamp });
        } else {
          repo.updateSyncState(ticker, '5min', { latestTimestamp: latest });
        }
      } else {
        repo.updateSyncState(ticker, '5min', { latestTimestamp: latest });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    repo.updateSyncState(ticker, '5min', { latestTimestamp: latest ?? 0, syncError: msg });
    throw err;
  }

  const rows = repo.getBars(ticker, '5min', cutoffMs, Date.now());
  return rows.map(mapRowToBar);
  });
}

/**
 * Persist a single completed 1-minute bar (called from WS AM event handler).
 * Uses INSERT OR IGNORE so duplicate bars (from overlapping fetches) are silently skipped.
 */
export function persistMinuteBar(bar: BarInput): void {
  const repo = new MarketDataRepository();
  repo.upsertBars([bar], 'IGNORE');
}

/**
 * Persist a single completed 10-second bar (called from the WS 10s bucket
 * finalizer). Bounded by the short rolling prune in getOrSyncTenSecondBars.
 */
export function persistTenSecondBar(bar: BarInput): void {
  const repo = new MarketDataRepository();
  repo.upsertBars([bar], 'IGNORE');
}

/**
 * 10-second bars — three-layer fetch like the other timeframes:
 *   L1 → CandleCache in-memory buffer (kept fresh by live WS accumulation)
 *   L2 → SQLite (10s rows for watched symbols, pruned to a ~2 h rolling window)
 *   L3 → Massive.com API (last ~70 minutes of 10-second aggregates on a cold fetch)
 *
 * The buffer is only served from cache once it actually holds HISTORY (a few
 * live buckets are not enough — they'd mask the REST seed and leave the chart
 * with 1–2 candles). An empty/unsupported REST response is retried at most once
 * every 5 minutes per symbol.
 */
const MIN_TEN_SEC_HISTORY = 120  // 20 min of buckets — enough to consider it seeded
const lastTenSecSeedAt = new Map<string, number>()

export interface TenSecondResult { bars: BarInput[]; seeded: boolean }

export async function getOrSyncTenSecondBars(ticker: string): Promise<TenSecondResult> {
  return dedupeSync(`${ticker}:10s`, async () => {
  const repo = new MarketDataRepository();
  const now = Date.now();
  const fromMs = now - TEN_SEC_LOOKBACK_MS;

  // L1: in-memory buffer — only serve when it holds real history.
  const cached = getCandleCache().get(ticker, '10s');
  if (cached && cached.length >= MIN_TEN_SEC_HISTORY) {
    return { bars: cached, seeded: false };
  }

  // L2: SQLite rolling window.
  const fromDb = repo.getBars(ticker, '10s', fromMs, now).map(mapRowToBar);
  if (fromDb.length >= MIN_TEN_SEC_HISTORY) {
    repo.pruneOlderThan(ticker, '10s', now - TEN_SEC_PRUNE_MS);
    getCandleCache().set(ticker, '10s', fromDb);
    return { bars: fromDb, seeded: true };
  }

  // L3: REST — with a cooldown so a temporarily-empty/unsupported response
  // isn't retried on every minute refresh.
  const lastAttempt = lastTenSecSeedAt.get(ticker) ?? 0;
  if (now - lastAttempt < 5 * 60_000) {
    return { bars: (cached && cached.length > 0) ? cached : fromDb, seeded: false };
  }
  lastTenSecSeedAt.set(ticker, now);

  try {
    const bars = await fetchAggregates(ticker, 10, 'second', String(fromMs), String(now));
    if (bars.length > 0) {
      repo.upsertBars(bars);
      repo.pruneOlderThan(ticker, '10s', now - TEN_SEC_PRUNE_MS);
      const bounded = bars.slice(-TEN_SEC_BUFFER);
      getCandleCache().set(ticker, '10s', bounded);
      return { bars: bounded, seeded: true };
    }
  } catch { /* non-critical — live accumulation builds the series */ }

  return { bars: (cached && cached.length > 0) ? cached : fromDb, seeded: false };
  });
}
