import type Database from 'better-sqlite3';
import type { Migration } from '../migration-manager';

/**
 * Migration: add-market-data-vwap
 * Version: 20260821000003
 * Description: The massive.com aggregates response carries the official VWAP
 * (`vw`) per bar alongside volume (`v`). Store it on MarketData so the chart's
 * VWAP overlay uses the feed's value instead of a local derivation. Existing
 * rows are NULL until re-synced — the chart falls back to a computed VWAP for
 * those bars.
 * Created: 2026-08-21T00:00:00.000Z
 */
const migration: Migration = {
  up(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(MarketData)").all() as { name: string }[];
    if (!cols.some(c => c.name === 'Vwap')) {
      db.exec('ALTER TABLE MarketData ADD COLUMN Vwap REAL');
    }
  },

  down(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(MarketData)").all() as { name: string }[];
    if (cols.some(c => c.name === 'Vwap')) {
      db.exec('ALTER TABLE MarketData DROP COLUMN Vwap');
    }
  },
};

export default migration;
