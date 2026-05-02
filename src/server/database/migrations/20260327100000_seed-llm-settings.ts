import type Database from 'better-sqlite3';
import type { Migration } from '../migration-manager';

/**
 * Migration: seed-llm-settings
 * Version: 20260327100000
 * Description: Seed default LLM / AI settings for AutoResearch
 * Created: 2026-03-27T10:00:00.000Z
 */

interface SeedSetting {
  key: string;
  value: string;
  type: string;
}

const defaults: SeedSetting[] = [
  { key: 'llm-provider', value: 'github-copilot', type: 'string' },
  {
    key: 'llm-details',
    value: JSON.stringify({
      apiKey: '',
      model: 'gpt-4o',
      apiUrl: 'https://models.inference.ai.azure.com',
    }),
    type: 'json',
  },
  { key: 'auto-research-max-iterations', value: '5', type: 'number' },
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
