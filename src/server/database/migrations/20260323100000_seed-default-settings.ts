import type Database from 'better-sqlite3';
import type { Migration } from '../migration-manager';

/**
 * Migration: seed-default-settings
 * Version: 20260323100000
 * Description: Seed default application settings
 * Created: 2026-03-23T10:00:00.000Z
 */

interface SeedSetting {
  key: string;
  value: string;
  type: string;
}

const defaults: SeedSetting[] = [
  // General — Trading Preferences
  { key: 'default-position-size', value: '100', type: 'number' },
  { key: 'risk-per-trade', value: '2', type: 'number' },
  { key: 'confirm-trades', value: 'true', type: 'boolean' },

  // Data Provider
  { key: 'active-data-broker', value: 'massive', type: 'string' },
  { key: 'data-broker-details', value: JSON.stringify({ apiKey: '', apiUrl: 'https://api.massive.com', wsUrl: 'wss://delayed.massive.com' }), type: 'json' },

  // Trading Broker
  { key: 'active-trading-broker', value: 'tradezero', type: 'string' },
  { key: 'trading-broker-details', value: JSON.stringify({ apiUrl: 'https://webapi.tradezero.com/', liveAccount: '', liveApiKeyId: '', liveApiKeySecret: '', paperAccount: '', paperApiKeyId: '', paperApiKeySecret: '' }), type: 'json' },
];

const migration: Migration = {
  up(db: Database.Database): void {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO Settings (Id, Key, Value, Type, CreatedAt, UpdatedAt)
      VALUES (lower(hex(randomblob(16))), @key, @value, @type, datetime('now'), datetime('now'))
    `);

    const seedAll = db.transaction(() => {
      for (const s of defaults) {
        insert.run({ key: s.key, value: s.value, type: s.type });
      }
    });

    seedAll();
  },

  down(db: Database.Database): void {
    const keys = defaults.map(s => `'${s.key}'`).join(', ');
    db.exec(`DELETE FROM Settings WHERE Key IN (${keys})`);
  },
};

export default migration;
