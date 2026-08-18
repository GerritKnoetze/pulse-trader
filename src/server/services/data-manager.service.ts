/**
 * Data Manager — holistic view + management of every data store in the app.
 *
 * Surfaces the three data layers for the Data Management UI:
 *   L1 → in-memory caches (CandleCache, SnapshotCache, row cache, WS intraday)
 *   L2 → SQLite (MarketData, MarketDataSyncState, Settings)
 *   L3 → upstream Massive.com API (history downloads, connection validation)
 *
 * All mutations keep L1 and L2 coherent (a bar edited/deleted in SQLite is
 * patched in the CandleCache too, so live charts don't serve stale values).
 */

import { existsSync, statSync } from 'fs';
import type { BarInput, SyncStateRow } from '../database/repositories/market-data-repository';
import { MarketDataRepository } from '../database/repositories/market-data-repository';
import { getConnectionManager } from '../database/connection-manager';
import { getCandleCache } from './candle-cache';
import { getSnapshotCache } from './snapshot-cache';
import { getScannerEngine } from './scanner-engine';
import { getWsRelay } from './ws-relay';
import { getMetrics } from './metrics';
import { getLogBuffer } from './app-log';
import {
  fetchAggregates,
  getOrSyncDailyBars,
  getOrSyncMinuteBars,
  getOrSyncFiveMinuteBars,
  getOrSyncTenSecondBars,
} from './market-data.service';
import { etDateString } from '../utils/et-time';

// ── Row shape returned to the UI ──────────────────────────────────────────────

export interface DataBarRow {
  id: string | null
  ticker: string
  timespan: string
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  transactions: number | null
  createdAt: string | null
  source: 'cache' | 'db'
}

export interface DataBatch {
  date: string
  count: number
  minTs: number
  maxTs: number
}

export interface DataSeries {
  ticker: string
  timespan: string
  count: number
  minTs: number | null
  maxTs: number | null
  cached: boolean
  cacheCount: number
  sync: SyncStateRow | null
}

// ── Overview ──────────────────────────────────────────────────────────────────

export function getOverview() {
  const repo = new MarketDataRepository();
  const conn = getConnectionManager();
  const dbStatus = conn.getStatus();
  const candleCache = getCandleCache();
  const snapshotCache = getSnapshotCache();
  const engine = getScannerEngine();
  const metrics = getMetrics();
  const relay = getWsRelay();

  const fileSizeBytes = dbStatus.path && existsSync(dbStatus.path)
    ? statSync(dbStatus.path).size
    : 0;

  const tables = repo.getTableList();

  const candleByTimespan: Record<string, number> = {};
  for (const e of candleCache.inspect()) {
    candleByTimespan[e.timespan] = (candleByTimespan[e.timespan] ?? 0) + e.count;
  }

  return {
    db: {
      connected: dbStatus.connected,
      path: dbStatus.path,
      fileSizeBytes,
      tables,
      totalBars: repo.getTotalBars(),
      totalSyncStates: repo.getSyncStates().length,
      settingsCount: tables.find(t => t.name === 'Settings')?.rows ?? 0,
    },
    l1: {
      candleEntries: candleCache.size,
      candleBars: candleCache.totalBars,
      candleByTimespan,
      snapshot: snapshotCache.info(),
      rowCache: engine.getCachedRows().length,
      intraday: engine.getIntradaySnapshot().length,
      tenSec: engine.getTenSecSnapshot().length,
      watched: engine.getWatchedSymbols(),
      wsStatus: relay.getStatus(),
      wsSubscriptions: relay.getSubscriptionCount(),
      sseClients: engine.getStatus().sseClients,
    },
    metrics: metrics.raw,
    engine: engine.getStatus(),
    syncStates: repo.getSyncStates(),
    logs: getLogBuffer().slice(-50),
    lastScan: engine.getStatus().lastScan,
  };
}

// ── L1 cache snapshot ─────────────────────────────────────────────────────────

export function getCacheSnapshot() {
  const candleCache = getCandleCache();
  const snapshotCache = getSnapshotCache();
  const engine = getScannerEngine();
  const relay = getWsRelay();

  return {
    candleEntries: candleCache.inspect(),
    snapshot: snapshotCache.info(),
    rowCache: engine.getCachedRows().map(r => ({
      symbol: r.symbol,
      last: r.last,
      chgDollar: r.chgDollar,
      chgPct: r.chgPct,
      enrichLevel: r.enrichLevel,
      wsActive: r.wsActive,
      day: r.day,
    })),
    intraday: engine.getIntradaySnapshot(),
    tenSec: engine.getTenSecSnapshot(),
    watched: engine.getWatchedSymbols(),
    ws: {
      status: relay.getStatus(),
      subscriptions: relay.getSubscriptionCount(),
    },
  };
}

// ── L2 series / batches / rows ────────────────────────────────────────────────

export function getSeries(): DataSeries[] {
  const repo = new MarketDataRepository();
  const candleCache = getCandleCache();
  const syncStates = new Map<string, SyncStateRow>();
  for (const s of repo.getSyncStates()) syncStates.set(`${s.Ticker}:${s.Timespan}`, s);

  return repo.getDataStatus().map(s => {
    const cachedBars = candleCache.peek(s.ticker, s.timespan);
    return {
      ticker: s.ticker,
      timespan: s.timespan,
      count: s.count,
      minTs: s.minTs,
      maxTs: s.maxTs,
      cached: cachedBars !== null,
      cacheCount: cachedBars?.length ?? 0,
      sync: syncStates.get(`${s.ticker}:${s.timespan}`) ?? null,
    };
  });
}

/** Group a series' stored bars into ET-calendar-day batches. */
export function getBatches(ticker: string, timespan: string): DataBatch[] {
  const repo = new MarketDataRepository();
  const timestamps = repo.getTimestamps(ticker, timespan);

  const groups = new Map<string, DataBatch>();
  for (const ts of timestamps) {
    const date = etDateString(ts);
    const g = groups.get(date);
    if (g) {
      g.count += 1;
      g.minTs = Math.min(g.minTs, ts);
      g.maxTs = Math.max(g.maxTs, ts);
    } else {
      groups.set(date, { date, count: 1, minTs: ts, maxTs: ts });
    }
  }

  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function getRows(
  ticker: string,
  timespan: string,
  opts: { source: 'cache' | 'db'; from?: number; to?: number; limit?: number } = { source: 'db' },
): DataBarRow[] {
  const repo = new MarketDataRepository();

  if (opts.source === 'cache') {
    const bars = getCandleCache().peek(ticker, timespan) ?? [];
    return bars.map(b => ({
      id: null,
      ticker: b.ticker,
      timespan: b.timespan,
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      transactions: b.transactions ?? null,
      createdAt: null,
      source: 'cache',
    }));
  }

  const from = opts.from ?? 0;
  const to = opts.to ?? Number.MAX_SAFE_INTEGER;
  const rows = repo.getBars(ticker, timespan, from, to);
  let out = rows.map(r => ({
    id: r.Id,
    ticker: r.Ticker,
    timespan: r.Timespan,
    timestamp: r.Timestamp,
    open: r.Open,
    high: r.High,
    low: r.Low,
    close: r.Close,
    volume: r.Volume,
    transactions: r.Transactions ?? null,
    createdAt: r.CreatedAt,
    source: 'db' as const,
  }));
  if (opts.limit && opts.limit > 0) out = out.slice(-opts.limit);
  return out;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export interface BarInputWithId extends BarInput {
  id?: string
}

/**
 * Insert (new timestamp) or update (existing id) a single bar.
 * The L1 cache is patched in lockstep so charts stay coherent.
 */
export function upsertBar(input: BarInputWithId): { ok: boolean; id: string | null; updated: boolean } {
  const repo = new MarketDataRepository();

  if (input.id) {
    const existing = repo.getBarById(input.id);
    // When the id no longer exists, fall through to an insert below.
    if (existing) {
      const changed = repo.updateBarById(input.id, {
        open: input.open,
        high: input.high,
        low: input.low,
        close: input.close,
        volume: input.volume,
        transactions: input.transactions ?? null,
      });
      if (changed > 0) {
        patchCacheBar({
          ticker: input.ticker,
          timespan: input.timespan,
          timestamp: existing.Timestamp,
          open: input.open,
          high: input.high,
          low: input.low,
          close: input.close,
          volume: input.volume,
          transactions: input.transactions,
        });
        return { ok: true, id: input.id, updated: true };
      }
    }
  }

  // Insert (natural-key REPLACE keeps the row unique on (ticker,timespan,timestamp)).
  const bar: BarInput = {
    ticker: input.ticker,
    timespan: input.timespan,
    timestamp: input.timestamp,
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    volume: input.volume,
    transactions: input.transactions,
  };
  const inserted = repo.upsertBars([bar], 'REPLACE');
  patchCacheBar(bar);
  const row = repo.getBars(bar.ticker, bar.timespan, bar.timestamp, bar.timestamp)[0];
  return { ok: inserted > 0, id: row?.Id ?? null, updated: false };
}

export function deleteBar(input: { id?: string; ticker: string; timespan: string; timestamp?: number }): { ok: boolean; deleted: number } {
  const repo = new MarketDataRepository();
  let deleted = 0;

  if (input.id) {
    const existing = repo.getBarById(input.id);
    if (existing) {
      deleted = repo.deleteById(input.id);
      if (deleted > 0) {
        removeCacheBar(existing.Ticker, existing.Timespan, existing.Timestamp);
        return { ok: true, deleted };
      }
    }
  }

  if (input.timestamp !== undefined) {
    deleted = repo.deleteByKey(input.ticker, input.timespan, input.timestamp);
    if (deleted > 0) {
      removeCacheBar(input.ticker, input.timespan, input.timestamp);
      return { ok: true, deleted };
    }
  }

  return { ok: false, deleted };
}

export function deleteBatch(ticker: string, timespan: string, date: string): { ok: boolean; deleted: number } {
  const rows = getRows(ticker, timespan, { source: 'db' });
  const targets = rows.filter(r => etDateString(r.timestamp) === date);
  const repo = new MarketDataRepository();
  let deleted = 0;
  for (const r of targets) {
    if (r.id) {
      deleted += repo.deleteById(r.id);
      removeCacheBar(ticker, timespan, r.timestamp);
    }
  }
  return { ok: true, deleted };
}

// ── Cache management ──────────────────────────────────────────────────────────

export interface FlushResult {
  candlesRemoved: number
  snapshotInvalidated: boolean
  rowsCleared: number
}

export function flushCache(opts: {
  scope: 'candles' | 'snapshot' | 'rows' | 'all';
  ticker?: string;
  timespan?: string;
}): FlushResult {
  const result: FlushResult = { candlesRemoved: 0, snapshotInvalidated: false, rowsCleared: 0 };

  if (opts.scope === 'candles' || opts.scope === 'all') {
    if (opts.ticker) {
      const before = getCandleCache().inspect().filter(e =>
        e.ticker === opts.ticker && (!opts.timespan || e.timespan === opts.timespan),
      );
      getCandleCache().invalidate(opts.ticker, opts.timespan);
      result.candlesRemoved = before.reduce((n, e) => n + e.count, 0);
    } else {
      result.candlesRemoved = getCandleCache().totalBars;
      getCandleCache().clear();
    }
  }

  if (opts.scope === 'snapshot' || opts.scope === 'all') {
    getSnapshotCache().invalidate();
    result.snapshotInvalidated = true;
  }

  if (opts.scope === 'rows' || opts.scope === 'all') {
    result.rowsCleared = getScannerEngine().clearRowCache();
  }

  return result;
}

/**
 * Force a re-sync of one candle-cache series from its source (L2/L3) and
 * rewrite the L1 entry. Returns how many bars ended up in each layer.
 */
export async function refreshCache(ticker: string, timespan: string): Promise<{
  ticker: string;
  timespan: string;
  cached: number;
  stored: number;
  seeded: boolean;
  error?: string;
}> {
  const repo = new MarketDataRepository();
  try {
    let bars: BarInput[] = [];
    let seeded = false;

    switch (timespan) {
      case 'day':
        bars = await getOrSyncDailyBars(ticker);
        break;
      case 'minute':
        bars = await getOrSyncMinuteBars(ticker);
        break;
      case '5min':
        bars = await getOrSyncFiveMinuteBars(ticker);
        break;
      case '10s': {
        const res = await getOrSyncTenSecondBars(ticker);
        bars = res.bars;
        seeded = res.seeded;
        break;
      }
      default:
        throw new Error(`Unsupported timespan for refresh: ${timespan}`);
    }

    if (bars.length > 0) getCandleCache().set(ticker, timespan, bars);
    else getCandleCache().invalidate(ticker, timespan);

    return {
      ticker,
      timespan,
      cached: bars.length,
      stored: repo.getBars(ticker, timespan, 0, Number.MAX_SAFE_INTEGER).length,
      seeded,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ticker,
      timespan,
      cached: getCandleCache().peek(ticker, timespan)?.length ?? 0,
      stored: repo.getBars(ticker, timespan, 0, Number.MAX_SAFE_INTEGER).length,
      seeded: false,
      error: msg,
    };
  }
}

// ── DB management ─────────────────────────────────────────────────────────────

export function flushDb(opts: {
  all?: boolean;
  ticker?: string;
  timespan?: string;
}): { deleted: number } {
  const repo = new MarketDataRepository();

  if (opts.all) {
    const deleted = repo.deleteAll();
    repo.deleteAllSyncStates();
    return { deleted };
  }

  if (!opts.ticker) return { deleted: 0 };

  const deleted = repo.deleteByTicker(opts.ticker, opts.timespan);
  repo.clearSyncState(opts.ticker, opts.timespan);
  getCandleCache().invalidate(opts.ticker, opts.timespan);
  return { deleted };
}

// ── L3 history download ───────────────────────────────────────────────────────

export async function downloadHistory(opts: {
  tickers: string[];
  timespan: string;
  multiplier: number;
  from: string;
  to: string;
}): Promise<Array<{ ticker: string; bars: number; error?: string }>> {
  const repo = new MarketDataRepository();
  const results: Array<{ ticker: string; bars: number; error?: string }> = [];

  for (const ticker of opts.tickers) {
    try {
      const bars = await fetchAggregates(ticker, opts.multiplier, opts.timespan, opts.from, opts.to);
      if (bars.length > 0) {
        repo.upsertBars(bars);
        getCandleCache().set(ticker, opts.timespan, bars);
      }
      results.push({ ticker, bars: bars.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ ticker, bars: 0, error: msg });
    }
  }

  return results;
}

// ── Private cache-coherence helpers ───────────────────────────────────────────

function patchCacheBar(bar: BarInput): void {
  const cached = getCandleCache().peek(bar.ticker, bar.timespan);
  if (cached === null) return;
  getCandleCache().appendBar(bar.ticker, bar.timespan, bar);
}

function removeCacheBar(ticker: string, timespan: string, timestamp: number): void {
  const cached = getCandleCache().peek(ticker, timespan);
  if (cached === null) return;
  const next = cached.filter(b => b.timestamp !== timestamp);
  if (next.length === 0) {
    getCandleCache().invalidate(ticker, timespan);
  } else {
    getCandleCache().set(ticker, timespan, next);
  }
}
