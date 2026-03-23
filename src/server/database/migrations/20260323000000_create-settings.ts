import type Database from 'better-sqlite3';
import type { Migration } from '../migration-manager';

/**
 * Migration: create-settings
 * Version: 20260323000000
 * Description: Create settings key-value store
 * Created: 2026-03-23T00:00:00.000Z
 */
const migration: Migration = {
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE Settings (
        Id TEXT PRIMARY KEY,
        Key TEXT NOT NULL UNIQUE,
        Value TEXT,
        Type TEXT NOT NULL,
        CreatedAt TEXT NOT NULL,
        UpdatedAt TEXT NOT NULL
      )
    `);

    db.exec('CREATE INDEX idx_settings_key ON Settings(Key)');
  },

  down(db: Database.Database): void {
    db.exec('DROP INDEX IF EXISTS idx_settings_key');
    db.exec('DROP TABLE IF EXISTS Settings');
  },
};

export default migration;
