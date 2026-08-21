import { BaseRepository } from '../base-repository';
import { getMetrics } from '../../services/metrics';

export interface MarketDataRow {
  Ticker: string;
  Timespan: string;
  Timestamp: number;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
  Transactions: number | null;
  CreatedAt: string;
}

export interface BarInput {
  ticker: string;
  timespan: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  transactions?: number;
}

export interface SyncStateRow {
  Ticker: string;
  Timespan: string;
  LatestTimestamp: number;
  LastSyncAt: string | null;
  GapStart: number | null;
  GapEnd: number | null;
  SyncError: string | null;
}

export class MarketDataRepository extends BaseRepository {
  /**
   * Bulk upsert bars into the cache.
   * Uses INSERT OR REPLACE for efficiency.
   */
  upsertBars(bars: BarInput[], onConflict: 'REPLACE' | 'IGNORE' = 'REPLACE'): number {
    // Persistence invariant: daily, 1-minute, 5-minute and 10-second bars are
    // stored in SQLite. 10s rows are pruned aggressively (short rolling window).
    // Everything else (other derived timeframes) is in-memory / ephemeral only.
    const persistable = bars.filter(b => b.timespan === 'day' || b.timespan === 'minute' || b.timespan === '5min' || b.timespan === '10s');
    if (persistable.length === 0) return 0;

    getMetrics().increment('sqliteWrites', persistable.length);
    const now = new Date().toISOString();
    let inserted = 0;

    this.executeInTransaction((db) => {
      // Natural-key primary key (Ticker, Timespan, Timestamp) — inserts are
      // ordered per series, so bulk minute syncs stay fast (one index, no
      // random-UUID page churn).
      const stmt = db.prepare(`
        INSERT OR ${onConflict} INTO MarketData
          (Ticker, Timespan, Timestamp, Open, High, Low, Close, Volume, Transactions, CreatedAt)
        VALUES
          (@ticker, @timespan, @timestamp, @open, @high, @low, @close, @volume, @transactions, @createdAt)
      `);

      for (const bar of persistable) {
        stmt.run({
          ticker: bar.ticker,
          timespan: bar.timespan,
          timestamp: bar.timestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          transactions: bar.transactions ?? null,
          createdAt: now,
        });
        inserted++;
      }
    });

    return inserted;
  }

  /**
   * Get bars for a ticker within a time range.
   */
  getBars(ticker: string, timespan: string, from: number, to: number): MarketDataRow[] {
    getMetrics().increment('sqliteReads');
    return this.executeQuery<MarketDataRow>(
      `SELECT * FROM MarketData
       WHERE Ticker = @ticker AND Timespan = @timespan
         AND Timestamp >= @from AND Timestamp <= @to
       ORDER BY Timestamp ASC`,
      { ticker, timespan, from, to },
    );
  }

  /**
   * Get the available date range for a ticker/timespan.
   */
  getAvailableRange(ticker: string, timespan: string): { min: number | null; max: number | null; count: number } {
    const result = this.executeQuery<{ minTs: number | null; maxTs: number | null; cnt: number }>(
      `SELECT MIN(Timestamp) as minTs, MAX(Timestamp) as maxTs, COUNT(*) as cnt
       FROM MarketData
       WHERE Ticker = @ticker AND Timespan = @timespan`,
      { ticker, timespan },
    );
    const row = result[0];
    return { min: row?.minTs ?? null, max: row?.maxTs ?? null, count: row?.cnt ?? 0 };
  }

  /**
   * Get a summary of all cached data.
   */
  getDataStatus(): { ticker: string; timespan: string; count: number; minTs: number; maxTs: number }[] {
    return this.executeQuery(
      `SELECT Ticker as ticker, Timespan as timespan, COUNT(*) as count,
              MIN(Timestamp) as minTs, MAX(Timestamp) as maxTs
       FROM MarketData
       GROUP BY Ticker, Timespan
       ORDER BY Ticker, Timespan`,
    );
  }

  /**
   * Get total bar count across all data.
   */
  getTotalBars(): number {
    const result = this.executeQuery<{ cnt: number }>('SELECT COUNT(*) as cnt FROM MarketData');
    return result[0]?.cnt ?? 0;
  }

  /**
   * Get the most recent bar timestamp for a ticker/timespan.
   * Returns null if no data exists yet.
   */
  getLatestTimestamp(ticker: string, timespan: string): number | null {
    const result = this.executeQuery<{ ts: number | null }>(
      'SELECT MAX(Timestamp) as ts FROM MarketData WHERE Ticker = @ticker AND Timespan = @timespan',
      { ticker, timespan },
    );
    return result[0]?.ts ?? null;
  }

  /**
   * Lightweight timestamp-only scan of a series (for daily-batch grouping).
   */
  getTimestamps(ticker: string, timespan: string): number[] {
    return this.executeQuery<{ Timestamp: number }>(
      `SELECT Timestamp FROM MarketData
       WHERE Ticker = @ticker AND Timespan = @timespan
       ORDER BY Timestamp ASC`,
      { ticker, timespan },
    ).map(r => r.Timestamp);
  }

  /**
   * Delete bars older than a cutoff timestamp for a ticker/timespan.
   * Used to maintain rolling windows for intraday data.
   */
  pruneOlderThan(ticker: string, timespan: string, cutoffMs: number): number {
    const result = this.executeRun(
      'DELETE FROM MarketData WHERE Ticker = @ticker AND Timespan = @timespan AND Timestamp < @cutoff',
      { ticker, timespan, cutoff: cutoffMs },
    );
    return result.changes;
  }

  /**
   * Delete all cached data for a ticker/timespan.
   */
  deleteByTicker(ticker: string, timespan?: string): number {
    if (timespan) {
      const result = this.executeRun(
        'DELETE FROM MarketData WHERE Ticker = @ticker AND Timespan = @timespan',
        { ticker, timespan },
      );
      return result.changes;
    }
    const result = this.executeRun(
      'DELETE FROM MarketData WHERE Ticker = @ticker',
      { ticker },
    );
    return result.changes;
  }

  /**
   * Delete a single bar by its natural key (ticker/timespan/timestamp).
   */
  deleteByKey(ticker: string, timespan: string, timestamp: number): number {
    const result = this.executeRun(
      'DELETE FROM MarketData WHERE Ticker = @ticker AND Timespan = @timespan AND Timestamp = @timestamp',
      { ticker, timespan, timestamp },
    );
    return result.changes;
  }

  /**
   * Fetch one bar by its natural key (ticker/timespan/timestamp).
   */
  getBarByKey(ticker: string, timespan: string, timestamp: number): MarketDataRow | null {
    const rows = this.executeQuery<MarketDataRow>(
      'SELECT * FROM MarketData WHERE Ticker = @ticker AND Timespan = @timespan AND Timestamp = @timestamp',
      { ticker, timespan, timestamp },
    );
    return rows[0] ?? null;
  }

  /**
   * Update OHLCV + volume fields on an existing bar by natural key.
   * Returns the number of rows changed (0 if the bar doesn't exist).
   */
  updateBarByKey(
    ticker: string,
    timespan: string,
    timestamp: number,
    fields: { open?: number; high?: number; low?: number; close?: number; volume?: number; transactions?: number | null },
  ): number {
    const sets: string[] = [];
    const params: Record<string, unknown> = { ticker, timespan, timestamp };
    if (fields.open !== undefined) { sets.push('Open = @open'); params.open = fields.open; }
    if (fields.high !== undefined) { sets.push('High = @high'); params.high = fields.high; }
    if (fields.low !== undefined) { sets.push('Low = @low'); params.low = fields.low; }
    if (fields.close !== undefined) { sets.push('Close = @close'); params.close = fields.close; }
    if (fields.volume !== undefined) { sets.push('Volume = @volume'); params.volume = fields.volume; }
    if (fields.transactions !== undefined) { sets.push('Transactions = @transactions'); params.transactions = fields.transactions; }
    if (sets.length === 0) return 0;
    const result = this.executeRun(
      `UPDATE MarketData SET ${sets.join(', ')}
       WHERE Ticker = @ticker AND Timespan = @timespan AND Timestamp = @timestamp`,
      params,
    );
    return result.changes;
  }

  /**
   * Delete every market-data row (full DB flush).
   */
  deleteAll(): number {
    const result = this.executeRun('DELETE FROM MarketData');
    return result.changes;
  }

  /**
   * Delete all sync-state rows (called together with a full DB flush).
   */
  deleteAllSyncStates(): number {
    const result = this.executeRun('DELETE FROM MarketDataSyncState');
    return result.changes;
  }

  /** Remove the sync-state row for a series. */
  clearSyncState(ticker: string, timespan: string): void {
    this.executeRun(
      'DELETE FROM MarketDataSyncState WHERE Ticker = @ticker AND Timespan = @timespan',
      { ticker, timespan },
    );
  }

  /** All sync-state rows (every (ticker, timespan) the app tracks). */
  getSyncStates(): SyncStateRow[] {
    return this.executeQuery<SyncStateRow>(
      `SELECT Ticker, Timespan, LatestTimestamp, LastSyncAt, GapStart, GapEnd, SyncError
       FROM MarketDataSyncState
       ORDER BY Ticker, Timespan`,
    );
  }

  /** List of user tables with approximate row counts (from sqlite_master). */
  getTableList(): { name: string; rows: number }[] {
    const tables = this.executeQuery<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'migration%'
       ORDER BY name`,
    );
    const db = this.connectionManager.getDatabase();
    return tables.map(t => {
      const safe = t.name.replace(/[^a-zA-Z0-9_]/g, '');
      try {
        const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${safe}"`).get() as { cnt: number };
        return { name: t.name, rows: row.cnt };
      } catch {
        return { name: t.name, rows: 0 };
      }
    });
  }

  // ── Sync state (MarketDataSyncState) ─────────────────────────────────────

  getSyncState(ticker: string, timespan: string): SyncStateRow | null {
    const rows = this.executeQuery<SyncStateRow>(
      `SELECT Ticker, Timespan, LatestTimestamp, LastSyncAt, GapStart, GapEnd, SyncError
       FROM MarketDataSyncState
       WHERE Ticker = @ticker AND Timespan = @timespan`,
      { ticker, timespan },
    );
    return rows[0] ?? null;
  }

  /**
   * Upsert the sync-state row for a ticker/timespan.
   * Pass `gapStart`/`gapEnd` to record an incomplete fetch; `clearGap` when a
   * later fetch completes the range.
   */
  updateSyncState(
    ticker: string,
    timespan: string,
    opts: {
      latestTimestamp?: number;
      gapStart?: number | null;
      gapEnd?: number | null;
      syncError?: string | null;
    } = {},
  ): void {
    const current = this.getSyncState(ticker, timespan);
    const latest = opts.latestTimestamp ?? current?.LatestTimestamp ?? 0;
    const gapStart = opts.gapStart !== undefined ? opts.gapStart : (current?.GapStart ?? null);
    const gapEnd = opts.gapEnd !== undefined ? opts.gapEnd : (current?.GapEnd ?? null);
    const error = opts.syncError !== undefined ? opts.syncError : (current?.SyncError ?? null);

    this.executeRun(
      `INSERT INTO MarketDataSyncState
         (Ticker, Timespan, LatestTimestamp, LastSyncAt, GapStart, GapEnd, SyncError)
       VALUES (@ticker, @timespan, @latest, @now, @gapStart, @gapEnd, @error)
       ON CONFLICT(Ticker, Timespan) DO UPDATE SET
         LatestTimestamp = @latest,
         LastSyncAt      = @now,
         GapStart        = @gapStart,
         GapEnd          = @gapEnd,
         SyncError       = @error`,
      { ticker, timespan, latest, now: new Date().toISOString(), gapStart, gapEnd, error },
    );
  }

  clearGap(ticker: string, timespan: string): void {
    this.updateSyncState(ticker, timespan, { gapStart: null, gapEnd: null, syncError: null });
  }
}
