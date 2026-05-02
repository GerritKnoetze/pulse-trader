import type Database from 'better-sqlite3';
import type { Migration } from '../migration-manager';

/**
 * Migration: create-market-data
 * Version: 20260326000000
 * Description: Create market data cache table for OHLCV bars
 * Created: 2026-03-26T00:00:00.000Z
 */
const migration: Migration = {
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE MarketData (
        Id TEXT PRIMARY KEY,
        Ticker TEXT NOT NULL,
        Timespan TEXT NOT NULL,
        Timestamp INTEGER NOT NULL,
        Open REAL NOT NULL,
        High REAL NOT NULL,
        Low REAL NOT NULL,
        Close REAL NOT NULL,
        Volume INTEGER NOT NULL,
        Transactions INTEGER,
        CreatedAt TEXT NOT NULL,
        UNIQUE(Ticker, Timespan, Timestamp)
      )
    `);

    db.exec('CREATE INDEX idx_market_data_lookup ON MarketData(Ticker, Timespan, Timestamp)');
    db.exec('CREATE INDEX idx_market_data_ticker ON MarketData(Ticker)');
  },

  down(db: Database.Database): void {
    db.exec('DROP INDEX IF EXISTS idx_market_data_ticker');
    db.exec('DROP INDEX IF EXISTS idx_market_data_lookup');
    db.exec('DROP TABLE IF EXISTS MarketData');
  },
};

export default migration;
