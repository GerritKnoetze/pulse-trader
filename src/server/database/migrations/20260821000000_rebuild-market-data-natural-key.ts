import type Database from 'better-sqlite3';
import type { Migration } from '../migration-manager';

/**
 * Migration: rebuild-market-data-natural-key
 * Version: 20260821000000
 * Description: Rebuild MarketData with the natural key (Ticker, Timespan,
 * Timestamp) as the PRIMARY KEY. Drops the random-UUID Id column, the redundant
 * UNIQUE(Ticker,Timespan,Timestamp) constraint, and the two redundant indexes
 * (idx_market_data_lookup / idx_market_data_ticker). This is the root-cause fix
 * for the slow cold-sync writes (intraday fetch timeouts): only ONE index is
 * now maintained and inserts are ordered by the natural key, so 30-40k-row
 * minute syncs drop from ~15-20s to well under a second.
 * Created: 2026-08-21T00:00:00.000Z
 */
const migration: Migration = {
  up(db: Database.Database): void {
    // The rebuild takes a write lock on a ~2M-row table — wait for it.
    db.pragma('busy_timeout = 60000');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE MarketData_new (
          Ticker       TEXT    NOT NULL,
          Timespan     TEXT    NOT NULL,
          Timestamp    INTEGER NOT NULL,
          Open         REAL    NOT NULL,
          High         REAL    NOT NULL,
          Low          REAL    NOT NULL,
          Close        REAL    NOT NULL,
          Volume       INTEGER NOT NULL,
          Transactions INTEGER,
          CreatedAt    TEXT    NOT NULL,
          PRIMARY KEY (Ticker, Timespan, Timestamp)
        )
      `);
      db.exec(`
        INSERT INTO MarketData_new (Ticker, Timespan, Timestamp, Open, High, Low, Close, Volume, Transactions, CreatedAt)
        SELECT Ticker, Timespan, Timestamp, Open, High, Low, Close, Volume, Transactions, CreatedAt
        FROM MarketData
      `);
      db.exec('DROP TABLE MarketData');
      db.exec('ALTER TABLE MarketData_new RENAME TO MarketData');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },

  down(db: Database.Database): void {
    db.pragma('busy_timeout = 60000');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE MarketData_old (
          Id           TEXT PRIMARY KEY,
          Ticker       TEXT    NOT NULL,
          Timespan     TEXT    NOT NULL,
          Timestamp    INTEGER NOT NULL,
          Open         REAL    NOT NULL,
          High         REAL    NOT NULL,
          Low          REAL    NOT NULL,
          Close        REAL    NOT NULL,
          Volume       INTEGER NOT NULL,
          Transactions INTEGER,
          CreatedAt    TEXT    NOT NULL,
          UNIQUE(Ticker, Timespan, Timestamp)
        )
      `);
      db.exec(`
        INSERT INTO MarketData_old (Id, Ticker, Timespan, Timestamp, Open, High, Low, Close, Volume, Transactions, CreatedAt)
        SELECT printf('%s|%s|%d', Ticker, Timespan, Timestamp), Ticker, Timespan, Timestamp, Open, High, Low, Close, Volume, Transactions, CreatedAt
        FROM MarketData
      `);
      db.exec('DROP TABLE MarketData');
      db.exec('ALTER TABLE MarketData_old RENAME TO MarketData');
      db.exec('CREATE INDEX idx_market_data_lookup ON MarketData(Ticker, Timespan, Timestamp)');
      db.exec('CREATE INDEX idx_market_data_ticker ON MarketData(Ticker)');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },
};

export default migration;
