import { randomUUID } from 'crypto';
import { BaseRepository } from '../base-repository';

export interface MarketDataRow {
  Id: string;
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

export class MarketDataRepository extends BaseRepository {
  /**
   * Bulk upsert bars into the cache.
   * Uses INSERT OR REPLACE for efficiency.
   */
  upsertBars(bars: BarInput[]): number {
    if (bars.length === 0) return 0;

    const now = new Date().toISOString();
    let inserted = 0;

    this.executeInTransaction((db) => {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO MarketData
          (Id, Ticker, Timespan, Timestamp, Open, High, Low, Close, Volume, Transactions, CreatedAt)
        VALUES
          (@id, @ticker, @timespan, @timestamp, @open, @high, @low, @close, @volume, @transactions, @createdAt)
      `);

      for (const bar of bars) {
        stmt.run({
          id: randomUUID(),
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
}
