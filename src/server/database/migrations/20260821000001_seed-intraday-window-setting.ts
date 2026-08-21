import type Database from 'better-sqlite3';
import type { Migration } from '../migration-manager';

/**
 * Migration: seed-intraday-window-setting
 * Version: 20260821000001
 * Description: Seed the intraday retention window setting (calendar days) for
 * the 1-minute / 5-minute series. User-adjustable via Settings → General.
 * Created: 2026-08-21T00:00:01.000Z
 */
const migration: Migration = {
  up(db: Database.Database): void {
    db.prepare(`
      INSERT OR IGNORE INTO Settings (Id, Key, Value, Type, CreatedAt, UpdatedAt)
      VALUES (lower(hex(randomblob(16))), 'intraday-window-calendar-days', '60', 'number', datetime('now'), datetime('now'))
    `).run();
  },

  down(db: Database.Database): void {
    db.exec("DELETE FROM Settings WHERE Key = 'intraday-window-calendar-days'");
  },
};

export default migration;
