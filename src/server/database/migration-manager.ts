import type Database from 'better-sqlite3';
import { readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import * as DatabaseLogger from './database.logger';
import {
  ConnectionManager,
  getConnectionManager,
} from './connection-manager';

// ── Public types ────────────────────────────────────────────

/** Contract every migration .ts file must satisfy */
export interface Migration {
  up(db: Database.Database): Promise<void> | void;
  down(db: Database.Database): Promise<void> | void;
}

export interface MigrationRecord {
  Version: string;
  Name: string;
  AppliedAt: Date;
  ExecutionTime: number;
  Checksum: string;
}

export interface MigrationStatus {
  appliedMigrations: MigrationRecord[];
  availableMigrations: MigrationFile[];
  pendingMigrations: MigrationFile[];
  lastAppliedVersion: string | null;
  totalAvailable: number;
  totalApplied: number;
  totalPending: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

// ── Internal types ──────────────────────────────────────────

interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  filepath: string;
  migration: Migration;
  checksum: string;
}

// ── Manager ─────────────────────────────────────────────────

export class MigrationManager {
  private connectionManager?: ConnectionManager;
  private readonly migrationsDir: string;

  constructor(
    migrationsDir: string = process.env.MIGRATION_DIR || join(__dirname, 'migrations'),
    connectionManager?: ConnectionManager,
  ) {
    this.migrationsDir = migrationsDir;
    if (connectionManager) {
      this.connectionManager = connectionManager;
    }
  }

  // ── Connection helpers ──────────────────────────────────────

  private getConnectionManager(): ConnectionManager {
    if (!this.connectionManager) {
      this.connectionManager = getConnectionManager();
    }
    return this.connectionManager;
  }

  private getDb() {
    return this.getConnectionManager().getDatabase();
  }

  // ── Initialisation ─────────────────────────────────────────

  initialize(): void {
    try {
      this.ensureMigrationHistoryTable();
      DatabaseLogger.logConnection('Migration system initialized');
    } catch (error) {
      DatabaseLogger.logError(error as Error, { operation: 'migration_initialize' });
      throw error;
    }
  }

  private ensureMigrationHistoryTable(): void {
    this.getDb().exec(`
      CREATE TABLE IF NOT EXISTS MigrationHistory (
        Version TEXT PRIMARY KEY,
        Name TEXT NOT NULL,
        AppliedAt TEXT NOT NULL,
        ExecutionTime INTEGER NOT NULL,
        Checksum TEXT NOT NULL
      )
    `);
  }

  // ── Migrate up ─────────────────────────────────────────────

  async migrateUp(targetVersion?: string): Promise<void> {
    DatabaseLogger.logConnection('Starting migration up', { targetVersion });

    try {
      this.initialize();
      const status = await this.getStatus();
      let pending = status.pendingMigrations;

      if (targetVersion) {
        pending = pending.filter((m) => m.version <= targetVersion);
      }

      if (pending.length === 0) {
        DatabaseLogger.logConnection('No migrations to apply');
        return;
      }

      DatabaseLogger.logConnection(`Applying ${pending.length} migration(s)`);

      for (const mf of pending) {
        await this.executeMigrationUp(mf);
      }

      DatabaseLogger.logConnection('All migrations applied successfully');
    } catch (error) {
      DatabaseLogger.logError(error as Error, { operation: 'migrate_up', targetVersion });
      throw error;
    }
  }

  // ── Migrate down ───────────────────────────────────────────

  async migrateDown(targetVersion: string): Promise<void> {
    DatabaseLogger.logConnection('Starting migration down', { targetVersion });

    try {
      this.initialize();
      const status = await this.getStatus();

      const toRollback = status.appliedMigrations
        .filter((m) => m.Version > targetVersion)
        .sort((a, b) => b.Version.localeCompare(a.Version));

      if (toRollback.length === 0) {
        DatabaseLogger.logConnection('No migrations to rollback');
        return;
      }

      DatabaseLogger.logConnection(`Rolling back ${toRollback.length} migration(s)`);

      for (const applied of toRollback) {
        const mf = status.availableMigrations.find(
          (m) => m.version === applied.Version && m.name === applied.Name,
        );
        if (!mf) throw new Error(`Migration file not found for ${applied.Version}_${applied.Name}`);

        await this.executeMigrationDown(mf);
      }

      DatabaseLogger.logConnection('Rollback completed successfully');
    } catch (error) {
      DatabaseLogger.logError(error as Error, { operation: 'migrate_down', targetVersion });
      throw error;
    }
  }

  // ── Status ─────────────────────────────────────────────────

  async getStatus(): Promise<MigrationStatus> {
    try {
      this.initialize();
      const applied = this.getAppliedMigrations();
      const available = await this.getMigrationFiles();
      const appliedVersions = new Set(applied.map((m) => m.Version));
      const pending = available.filter((m) => !appliedVersions.has(m.version));
      const last = applied.length > 0 ? applied[applied.length - 1].Version : null;

      return {
        appliedMigrations: applied,
        availableMigrations: available,
        pendingMigrations: pending,
        lastAppliedVersion: last,
        totalAvailable: available.length,
        totalApplied: applied.length,
        totalPending: pending.length,
      };
    } catch (error) {
      DatabaseLogger.logError(error as Error, { operation: 'get_migration_status' });
      throw error;
    }
  }

  // ── Validate ───────────────────────────────────────────────

  async validateMigrations(): Promise<ValidationResult> {
    try {
      const status = await this.getStatus();
      const issues: string[] = [];

      for (const applied of status.appliedMigrations) {
        const mf = status.availableMigrations.find(
          (m) => m.version === applied.Version && m.name === applied.Name,
        );

        if (!mf) {
          issues.push(`Applied migration ${applied.Version}_${applied.Name} not found in files`);
          continue;
        }
        if (mf.checksum !== applied.Checksum) {
          issues.push(`Checksum mismatch for ${applied.Version}_${applied.Name} — file may have been modified`);
        }
      }

      // Detect sequence gaps
      const versions = status.appliedMigrations.map((m) => m.Version).sort();
      for (let i = 1; i < versions.length; i++) {
        const prev = versions[i - 1];
        const curr = versions[i];
        const skipped = status.availableMigrations.filter(
          (m) => m.version > prev && m.version < curr,
        );
        if (skipped.length > 0) {
          issues.push(`Gap: unapplied migrations exist between ${prev} and ${curr}`);
        }
      }

      return { valid: issues.length === 0, issues };
    } catch (error) {
      DatabaseLogger.logError(error as Error, { operation: 'validate_migrations' });
      throw error;
    }
  }

  // ── Reset (dev only) ──────────────────────────────────────

  reset(force: boolean = false): void {
    if (!force) throw new Error('Reset requires force=true. This will DROP ALL DATA!');

    DatabaseLogger.logConnection('DANGER: Resetting all migrations');
    try {
      this.getDb().exec('DROP TABLE IF EXISTS MigrationHistory');
      DatabaseLogger.logConnection('Migration history table dropped');
    } catch (error) {
      DatabaseLogger.logError(error as Error, { operation: 'reset_migrations' });
      throw error;
    }
  }

  // ── Private: execute single migration ─────────────────────

  private async executeMigrationUp(mf: MigrationFile): Promise<number> {
    const startTime = Date.now();
    const db = this.getDb();

    DatabaseLogger.logConnection(`Applying: ${mf.version}_${mf.name}`);

    try {
      await mf.migration.up(db);

      const executionTime = Date.now() - startTime;

      db.prepare(`
        INSERT INTO MigrationHistory (Version, Name, AppliedAt, ExecutionTime, Checksum)
        VALUES (@Version, @Name, @AppliedAt, @ExecutionTime, @Checksum)
      `).run({
        Version: mf.version,
        Name: mf.name,
        AppliedAt: new Date().toISOString(),
        ExecutionTime: executionTime,
        Checksum: mf.checksum,
      });

      DatabaseLogger.logConnection(`${mf.version}_${mf.name} applied (${executionTime}ms)`);
      return executionTime;
    } catch (error) {
      throw new Error(`Migration ${mf.filename} up() failed: ${error}`);
    }
  }

  private async executeMigrationDown(mf: MigrationFile): Promise<number> {
    const startTime = Date.now();
    const db = this.getDb();

    DatabaseLogger.logConnection(`Rolling back: ${mf.version}_${mf.name}`);

    try {
      await mf.migration.down(db);

      db.prepare('DELETE FROM MigrationHistory WHERE Version = @Version').run({
        Version: mf.version,
      });

      const executionTime = Date.now() - startTime;
      DatabaseLogger.logConnection(`${mf.version}_${mf.name} rolled back (${executionTime}ms)`);
      return executionTime;
    } catch (error) {
      throw new Error(`Migration ${mf.filename} down() failed: ${error}`);
    }
  }

  // ── Private: read applied history ─────────────────────────

  private getAppliedMigrations(): MigrationRecord[] {
    const rows = this.getDb()
      .prepare('SELECT Version, Name, AppliedAt, ExecutionTime, Checksum FROM MigrationHistory ORDER BY Version ASC')
      .all() as MigrationRecord[];

    return rows.map((r) => ({
      ...r,
      AppliedAt: new Date(r.AppliedAt as unknown as string),
    }));
  }

  // ── Private: scan & import .ts migration files ────────────

  private async getMigrationFiles(): Promise<MigrationFile[]> {
    if (!existsSync(this.migrationsDir)) return [];

    const files = readdirSync(this.migrationsDir);
    const pattern = /^(\d+)_(.+)\.ts$/;
    const migrations: MigrationFile[] = [];

    for (const file of files) {
      if (!pattern.test(file)) continue;
      const match = file.match(pattern)!;
      const [, version, name] = match;
      const filepath = join(this.migrationsDir, file);

      try {
        // Import the TypeScript migration file
        let module;
        try {
          // Try direct import (works with tsx CLI)
          const fileUrl = pathToFileURL(filepath).href;
          module = await import(fileUrl);
        } catch (tsError: any) {
          if (tsError.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
            // Fallback: use tsx programmatically for .ts files under Nitro runtime
            const { register } = await import('tsx/esm/api');
            const unregister = register();
            try {
              const fileUrl = pathToFileURL(filepath).href;
              module = await import(fileUrl + '?t=' + Date.now());
            } finally {
              unregister();
            }
          } else {
            throw tsError;
          }
        }

        const migration: Migration = module.default || module;

        if (!migration.up || !migration.down) {
          console.warn(`Migration ${file} missing up() or down() — skipped`);
          continue;
        }

        migrations.push({
          version,
          name,
          filename: file,
          filepath,
          migration,
          checksum: this.calculateChecksum(filepath),
        });
      } catch (error) {
        console.error(`Failed to load migration ${file}:`, error);
      }
    }

    return migrations.sort((a, b) => a.version.localeCompare(b.version));
  }

  private calculateChecksum(filepath: string): string {
    const stats = statSync(filepath);
    return createHash('sha256')
      .update(filepath + stats.mtime.toISOString())
      .digest('hex');
  }
}
