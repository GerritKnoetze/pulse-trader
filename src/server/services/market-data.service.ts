import { restClient } from '@massive.com/client-js';
import { SettingsRepository } from '../database/repositories/settings-repository';
import { MarketDataRepository } from '../database/repositories/market-data-repository';
import type { BarInput } from '../database/repositories/market-data-repository';
import { decryptJsonFields } from '../utils/encryption';
import { getMetrics } from './metrics';
import { getCandleCache } from './candle-cache';
import { enrichBarSeries } from './indicator-enrich.service';
import { daysAgoEt, todayEt, yesterdayEt } from '../utils/et-time';
import { EMA_WARMUP_BARS } from '../../app/utils/indicators';

// Hard ceiling for any single upstream API call — a hung Massive.com request
// must never block a scan, chart, or sync indefinitely.
const FETCH_TIMEOUT_MS = 15_000;

/** Millisecond period of one bar for a given app timespan. */
export function barPeriodMs(timespan: string): number {
  switch (timespan) {
    case 'day':   return 86_400_000
    case '5min':  return 300_000
    case 'minute':return 60_000
    case '10s':   return 10_000
    default:      return 60_000
  }
}

/**
 * Extra leading history (in ms) the indicator computation needs before the
 * display window so EMA(200) is exact from the first visible bar. The data
 * layer fetches and RETAINS window + this much context; the compute layer trims
 * the warm-up prefix so the client never sees the SMA seed ramp.
 */
export function warmupMs(timespan: string): number {
  return EMA_WARMUP_BARS * barPeriodMs(timespan)
}

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
  vw?: number; // volume-weighted average price (VWAP)
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

// Provider `t` for 10-second bars is not epoch-aligned — Massive labels each
// bar a few seconds INTO its window (e.g. :08 instead of :00, :18 instead of
// :10 — consistently `t % 10000 == 8000`). Bars are still exactly 10s apart.
// We snap each bar back to the 10-second window that CONTAINS it (floor), which
// is the same epoch-aligned start the live WS accumulator uses
// (floor(tick.s/10000)*10000). This makes the chart axis / crosshair labels
// round again and lets REST-seeded bars dedupe against the live buckets (they
// land on the identical timestamps). NEVER use round here — round would shift
// every bar one window forward (e.g. :08 -> :10), misaligning against the live
// bars and creating doubled/overlapping candles.
const TEN_SEC_MS = 10_000;
function alignTenSecTimestamp(ts: number): number {
  return Math.floor(ts / TEN_SEC_MS) * TEN_SEC_MS;
}

function mapBar(ticker: string, timespan: string, bar: MassiveBar): BarInput {
  return {
    ticker,
    timespan,
    timestamp: timespan === '10s' ? alignTenSecTimestamp(bar.t ?? 0) : (bar.t ?? 0),
    open: bar.o ?? 0,
    high: bar.h ?? 0,
    low: bar.l ?? 0,
    close: bar.c ?? 0,
    volume: bar.v ?? 0,
    vwap: bar.vw ?? undefined,
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
    vwap: row.Vwap ?? undefined,
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
    timestamp: row.Timespan === '10s' ? alignTenSecTimestamp(row.Timestamp) : row.Timestamp,
    open: row.Open,
    high: row.High,
    low: row.Low,
    close: row.Close,
    volume: row.Volume,
    vwap: row.Vwap ?? undefined,
    transactions: row.Transactions ?? undefined,
  };
}

// ── User-configurable lookback / retention windows ─────────────────────────────
// Each maps to a numeric Settings key (Settings → General → Data Retention),
// read with a 30 s TTL cache and invalidated on save so changes apply fast.

const SETTINGS_TTL_MS = 30_000;

interface NumericSetting {
  get(): number;
  invalidate(): void;
}

function numericSetting(key: string, def: number): NumericSetting {
  let value: number | null = null;
  let expiry = 0;
  return {
    get(): number {
      if (value !== null && Date.now() < expiry) return value;
      let v = def;
      try {
        const raw = new SettingsRepository().getValue(key);
        const parsed = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) v = parsed;
      } catch { /* fall back to default */ }
      value = v;
      expiry = Date.now() + SETTINGS_TTL_MS;
      return value;
    },
    invalidate(): void { value = null; expiry = 0; },
  };
}

// Daily history lookback (default 600 calendar days ≈ 400 trading days) —
// enough for weekly/monthly aggregation, ATR14, avgVol30.
const dailyLookback = numericSetting('daily-lookback-calendar-days', 600);
export const getDailyLookbackDays = dailyLookback.get;
export const invalidateDailyLookbackCache = dailyLookback.invalidate;

// Intraday (1-min / 5-min) retention window (default 60 calendar days ≈ 42
// trading days — 200 EMA on the 60-min panel + MACD warm-up margin).
const intradayWindow = numericSetting('intraday-window-calendar-days', 60);
export const getIntradayWindowDays = intradayWindow.get;
export const invalidateIntradayWindowCache = intradayWindow.invalidate;

// 10-second bars: look back on a cold fetch (default 70 minutes ≈ 420 bars —
// enough to seed a 200 EMA with context) and prune SQLite rows older than the
// rolling window (default 2 hours).
const tenSecLookback = numericSetting('ten-second-lookback-minutes', 70);
export const getTenSecondLookbackMs = (): number => tenSecLookback.get() * 60_000;
export const invalidateTenSecondLookbackCache = tenSecLookback.invalidate;

const tenSecPrune = numericSetting('ten-second-prune-hours', 2);
export const getTenSecondPruneMs = (): number => tenSecPrune.get() * 3_600_000;
export const invalidateTenSecondPruneCache = tenSecPrune.invalidate;

/** Maximum 10s bars kept per symbol in the in-memory buffer (~75 min). */
export const TEN_SEC_BUFFER = 450;

// ── Session-scoped prune-cutoff override (chart "load more") ───────────────────
// The retention windows above hard-prune old bars (e.g. minute/5min older than
// the intraday window, 10s older than ~2 h) whenever a series is re-synced. A
// chart's "load more" fetches OLDER bars than those windows would normally keep,
// so it requests a per-(ticker, timespan) override that PUSHES THE PRUNE CUTOFF
// back for this process session only. Closing the chart clears it, restoring the
// default retention window until the user again loads more candles.
const pruneCutoffOverride = new Map<string, number>();   // `${ticker}:${timespan}` -> cutoffMs

export function getPruneCutoffMs(ticker: string, timespan: string, defaultCutoffMs: number): number {
  return pruneCutoffOverride.get(`${ticker}:${timespan}`) ?? defaultCutoffMs;
}

/** Extend the prune cutoff back to `cutoffMs` (keeps the loaded older bars). */
export function extendPruneCutoff(ticker: string, timespan: string, cutoffMs: number): void {
  const key = `${ticker}:${timespan}`;
  const current = pruneCutoffOverride.get(key);
  pruneCutoffOverride.set(key, current === undefined ? cutoffMs : Math.min(current, cutoffMs));
}

/** Clear a single series' override (a fresh chart load uses the default window). */
export function clearPruneCutoff(ticker: string, timespan: string): void {
  pruneCutoffOverride.delete(`${ticker}:${timespan}`);
}

/** Clear every timespan override for a symbol — called when its chart unwatches. */
export function clearSymbolPruneCutoffs(ticker: string): void {
  const prefix = `${ticker}:`;
  for (const key of pruneCutoffOverride.keys()) {
    if (key.startsWith(prefix)) pruneCutoffOverride.delete(key);
  }
}

// ── Vwap backfill (one-time, lazy) ────────────────────────────────────────────
// Rows written before the Vwap column existed have NULL Vwap, so the VWAP
// overlay only drew on the freshly-synced tail. When a series is next synced and
// its latest stored bar still lacks Vwap, we re-fetch the full window (REPLACE)
// once so every row picks up the aggregate's `vw` straight from the feed. A
// per-process guard skips series where the feed itself returns no vwap.
const vwapBackfilled = new Set<string>();

function vwapBackfillKey(ticker: string, timespan: string): string {
  return `${ticker}:${timespan}`;
}

function needsVwapBackfill(ticker: string, timespan: string, latestRow: MarketDataRow | null): boolean {
  if (!latestRow || vwapBackfilled.has(vwapBackfillKey(ticker, timespan))) return false;
  return latestRow.Vwap == null;
}

function markVwapBackfilled(ticker: string, timespan: string): void {
  vwapBackfilled.add(vwapBackfillKey(ticker, timespan));
}

/** Public check for callers that need to know a series is about to backfill. */
export function needsSeriesVwapBackfill(ticker: string, timespan: string): boolean {
  return needsVwapBackfill(ticker, timespan, new MarketDataRepository().getLatestBar(ticker, timespan));
}

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
  const latestRow = repo.getLatestBar(ticker, 'day');
  const latest = latestRow?.Timestamp ?? null;
  const backfill = needsVwapBackfill(ticker, 'day', latestRow);

  try {
    if (latest === null || backfill) {
      // First fetch OR vwap backfill: pull full history (REPLACE overwrites the
      // NULL-Vwap rows with the feed's vw). Fetch `display + warm-up` days so
      // the indicator layer has EMA(200) context before the displayed window.
      const from = daysAgoEt(getDailyLookbackDays() + EMA_WARMUP_BARS);
      const bars = await fetchAggregates(ticker, 1, 'day', from, toStr);
      if (bars.length > 0) {
        repo.upsertBars(bars);
        repo.updateSyncState(ticker, 'day', { latestTimestamp: bars[bars.length - 1]!.timestamp });
        if (!bars[bars.length - 1]!.vwap) markVwapBackfilled(ticker, 'day');
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
  cutoff.setDate(cutoff.getDate() - getDailyLookbackDays());
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
  cutoff.setDate(cutoff.getDate() - getIntradayWindowDays());
  const cutoffMs = cutoff.getTime();

  // Prune expired bars first — BUT retain the EMA/MACD warm-up context that the
  // ET-calendar fetch overshoot produced before the display cut-off, so the
  // indicator layer can compute EMA(200) exactly (trimmed, not shown).
  repo.pruneOlderThan(ticker, 'minute', getPruneCutoffMs(ticker, 'minute', cutoffMs - warmupMs('minute')));

  const latestRow = repo.getLatestBar(ticker, 'minute');
  const latest = latestRow?.Timestamp ?? null;
  const backfill = needsVwapBackfill(ticker, 'minute', latestRow);

  try {
    if (latest === null || latest < cutoffMs || backfill) {
      // No data / all expired / vwap backfill: fetch full window. REPLACE
      // overwrites the NULL-Vwap rows with the feed's vw when backfilling.
      const fromStr = daysAgoEt(getIntradayWindowDays());
      const toStr = todayEt();
      const bars = await fetchAggregates(ticker, 1, 'minute', fromStr, toStr);
      if (bars.length > 0) {
        repo.upsertBars(bars, backfill ? 'REPLACE' : 'IGNORE');
        repo.updateSyncState(ticker, 'minute', { latestTimestamp: bars[bars.length - 1]!.timestamp });
        if (!bars[bars.length - 1]!.vwap) markVwapBackfilled(ticker, 'minute');
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
  cutoff.setDate(cutoff.getDate() - getIntradayWindowDays());
  const cutoffMs = cutoff.getTime();

  // Retain EMA/MACD warm-up context before the display cut-off (see minute).
  repo.pruneOlderThan(ticker, '5min', getPruneCutoffMs(ticker, '5min', cutoffMs - warmupMs('5min')));

  const latestRow = repo.getLatestBar(ticker, '5min');
  const latest = latestRow?.Timestamp ?? null;
  const backfill = needsVwapBackfill(ticker, '5min', latestRow);

  try {
    if (latest === null || latest < cutoffMs || backfill) {
      const fromStr = daysAgoEt(getIntradayWindowDays());
      const toStr = todayEt();
      const bars = await fetchAggregates(ticker, 5, 'minute', fromStr, toStr);
      if (bars.length > 0) {
        repo.upsertBars(bars, 'REPLACE');
        repo.updateSyncState(ticker, '5min', { latestTimestamp: bars[bars.length - 1]!.timestamp });
        if (!bars[bars.length - 1]!.vwap) markVwapBackfilled(ticker, '5min');
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
  // Fetch at least `display buffer + EMA warm-up` bars so the indicator layer has
  // EMA(200) context before the displayed buffer, even when the configured
  // lookback is shorter. Display stays capped at TEN_SEC_BUFFER; the extra bars
  // are warm-up context stored in DB and trimmed by the indicator enrich.
  const fromMs = now - Math.max(getTenSecondLookbackMs(), (TEN_SEC_BUFFER + EMA_WARMUP_BARS) * 10_000);

  // L1: in-memory buffer — only serve when it holds real history.
  const cached = getCandleCache().get(ticker, '10s');
  if (cached && cached.length >= MIN_TEN_SEC_HISTORY) {
    return { bars: cached, seeded: false };
  }

  // L2: SQLite rolling window.
  const fromDb = repo.getBars(ticker, '10s', fromMs, now).map(mapRowToBar);
  if (fromDb.length >= MIN_TEN_SEC_HISTORY) {
    repo.pruneOlderThan(ticker, '10s', getPruneCutoffMs(ticker, '10s', now - getTenSecondPruneMs()));
    getCandleCache().set(ticker, '10s', fromDb);
    return { bars: fromDb, seeded: true };
  }

  // L3: REST — with a cooldown so a temporarily-empty/unsupported response
  // isn't retried on every minute refresh. A pending vwap backfill bypasses it.
  const lastAttempt = lastTenSecSeedAt.get(ticker) ?? 0;
  const backfill = needsVwapBackfill(ticker, '10s', repo.getLatestBar(ticker, '10s'));
  if (!backfill && now - lastAttempt < 5 * 60_000) {
    return { bars: (cached && cached.length > 0) ? cached : fromDb, seeded: false };
  }
  lastTenSecSeedAt.set(ticker, now);

  try {
    const bars = await fetchAggregates(ticker, 10, 'second', String(fromMs), String(now));
    if (bars.length > 0) {
      repo.upsertBars(bars);
      repo.pruneOlderThan(ticker, '10s', getPruneCutoffMs(ticker, '10s', now - getTenSecondPruneMs()));
      const bounded = bars.slice(-TEN_SEC_BUFFER);
      getCandleCache().set(ticker, '10s', bounded);
      if (!bars[bars.length - 1]!.vwap) markVwapBackfilled(ticker, '10s');
      return { bars: bounded, seeded: true };
    }
  } catch { /* non-critical — live accumulation builds the series */ }

  return { bars: (cached && cached.length > 0) ? cached : fromDb, seeded: false };
  });
}

// ── Chart "load more" — fetch `count` bars OLDER than `beforeMs` ──────────────
// Backfills the LEFT side of a chart pane on demand. Reads the range from the DB
// while it is still inside the retention window (cheap, no provider call);
// otherwise fetches the range from the provider, persists it and PUSHES THE PRUNE
// CUTOFF back (extendPruneCutoff) so the re-sync cycle does not delete these older
// bars while the chart is open. Returned bars carry exact indicators.
const PANEL_PROVIDER: Record<string, { multiplier: number; timespan: string }> = {
  day:    { multiplier: 1,  timespan: 'day' },
  '5min': { multiplier: 5,  timespan: 'minute' },
  minute: { multiplier: 1,  timespan: 'minute' },
  '10s':  { multiplier: 10, timespan: 'second' },
}

export interface LoadMoreResult { bars: BarInput[]; hasMore: boolean }

export async function loadOlderBars(
  ticker: string,
  appTimespan: string,
  beforeMs: number,
  count: number,
): Promise<LoadMoreResult> {
  const repo = new MarketDataRepository()
  const period = barPeriodMs(appTimespan)
  const countN = Math.max(1, Math.min(3000, Math.round(count)))
  const to = beforeMs - period          // strict: strictly older than the current oldest bar

  // A `count × period` CLOCK window can hold far fewer than `count` bars on
  // sparse symbols (trading-day/trading-minute gaps). Widen the window backward
  // up to WIDEN_LIMIT chunks until it collects `countN` bars.
  let from = to - countN * period
  let bars: BarInput[] = []
  const WIDEN_LIMIT = 6
  for (let i = 0; i < WIDEN_LIMIT && bars.length < countN; i++) {
    bars = readCachedBars(ticker, appTimespan, from, to)
    if (bars.length < countN) from -= countN * period
  }

  // Still short → the range is at/outside the retention boundary: pull a
  // generous window from the provider and retain it for this chart's session.
  if (bars.length < countN) {
    const provider = PANEL_PROVIDER[appTimespan] ?? PANEL_PROVIDER.minute!
    const wideFrom = from - countN * period * 4
    try {
      // The daily feed uses calendar-date strings; intraday feeds take raw
      // epoch-ms strings.
      const fromArg = appTimespan === 'day' ? new Date(wideFrom).toISOString().slice(0, 10) : String(wideFrom)
      const toArg   = appTimespan === 'day' ? new Date(to).toISOString().slice(0, 10)       : String(to)
      const pBars = await fetchAggregates(ticker, provider.multiplier, provider.timespan, fromArg, toArg)
      if (pBars.length > 0) {
        repo.upsertBars(pBars, 'IGNORE')
        extendPruneCutoff(ticker, appTimespan, wideFrom)
        // Merge with any DB bars already held (provider wins on equal timestamps),
        // then keep the NEWEST `countN` (closest to the visible oldest bar).
        const byTime = new Map<number, BarInput>()
        for (const b of bars) byTime.set(b.timestamp, b)
        for (const b of pBars) byTime.set(b.timestamp, b)
        bars = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-countN)
      }
    } catch { /* non-critical — surface only what we already held */ }
  }

  if (bars.length === 0) return { bars: [], hasMore: false }

  const enriched = enrichBarSeries(ticker, appTimespan, bars)
  // Optimistic "more": the button stays alive while a page is returned and only
  // hides once a load-more returns nothing (true data start). This avoids the
  // daily panel's trading-vs-calendar-day sparseness falsely hiding the button.
  return { bars: enriched, hasMore: true }
}
