import type Database from 'better-sqlite3';
import type { Migration } from '../migration-manager';

/**
 * Migration: seed-data-window-settings
 * Version: 20260821000002
 * Description: Seed the daily lookback + 10-second retention settings
 * (Settings → General → Data Retention).
 * Created: 2026-08-21T00:00:02.000Z
 */
interface SeedSetting {
  key: string;
  value: string;
  type: string;
}

const defaults: SeedSetting[] = [
  { key: 'daily-lookback-calendar-days', value: '600', type: 'number' },
  { key: 'ten-second-lookback-minutes', value: '70', type: 'number' },
  { key: 'ten-second-prune-hours', value: '2', type: 'number' },
];

const migration: Migration = {
  up(db: Database.Database): void {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO Settings (Id, Key, Value, Type, CreatedAt, UpdatedAt)
      VALUES (lower(hex(randomblob(16))), @key, @value, @type, datetime('now'), datetime('now'))
    `);
    const seedAll = db.transaction(() => {
      for (const s of defaults) insert.run({ key: s.key, value: s.value, type: s.type });
    });
    seedAll();
  },

  down(db: Database.Database): void {
    const keys = defaults.map(s => `'${s.key}'`).join(', ');
    db.exec(`DELETE FROM Settings WHERE Key IN (${keys})`);
  },
};

export default migration;
