import type Database from 'better-sqlite3';
import type { Migration } from '../migration-manager';

/**
 * Migration: create-market-data-sync-state
 * Version: 20260817000000
 * Description: Per-(ticker, timespan) sync-state record so staleness decisions
 *              and gap tracking are centralized instead of inferred from the
 *              latest stored bar alone.
 * Created: 2026-08-17
 */

const migration: Migration = {
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS MarketDataSyncState (
        Ticker          TEXT    NOT NULL,
        Timespan        TEXT    NOT NULL,
        LatestTimestamp INTEGER NOT NULL DEFAULT 0,
        LastSyncAt      TEXT,
        GapStart        INTEGER,
        GapEnd          INTEGER,
        SyncError       TEXT,
        PRIMARY KEY (Ticker, Timespan)
      );
    `);
  },

  down(db: Database.Database): void {
    db.exec('DROP TABLE IF EXISTS MarketDataSyncState;');
  },
};

export default migration;
