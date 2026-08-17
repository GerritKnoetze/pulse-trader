import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import * as DatabaseLogger from './database.logger';

/**
 * Resolve the default SQLite database path.
 *
 * Priority: runtime config (absolute path baked at build/dev time) >
 * DB_PATH env var > an existing database near the working directory.
 *
 * Never rely on process.cwd() alone — the production server (nuxt preview)
 * chdirs into .output, so a cwd-relative path would silently create an empty
 * database inside .output instead of using the real one at the project root.
 */
function resolveDefaultDbPath(): string {
  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig() as { dbPath?: string };
      if (config?.dbPath) return config.dbPath;
    }
  } catch {
    // Not running inside a Nitro context (e.g. migrate scripts via tsx).
  }
  if (process.env.DB_PATH) return process.env.DB_PATH;

  // Dev runs from the project root; preview runs from .output (one level up).
  const fallbacks = [
    join(process.cwd(), 'data', 'pulse-trader.db'),
    join(process.cwd(), '..', 'data', 'pulse-trader.db'),
  ];
  for (const candidate of fallbacks) {
    if (existsSync(candidate)) return candidate;
  }
  return fallbacks[0];
}

export class ConnectionManager {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || resolveDefaultDbPath();
    this.initialize();
  }

  private initialize(): void {
    try {
      const dbDir = join(this.dbPath, '..');
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
      }

      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
    } catch (error) {
      DatabaseLogger.logError(error as Error, { operation: 'initialize_connection' });
      throw error;
    }
  }

  public getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  public getStatus() {
    return {
      connected: this.db !== null,
      path: this.dbPath,
    };
  }

  public shutdown(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      DatabaseLogger.logConnection('shutdown_completed');
    }
  }
}

// Singleton
let connectionManager: ConnectionManager;

export function getConnectionManager(): ConnectionManager {
  if (!connectionManager) {
    connectionManager = new ConnectionManager();
  }
  return connectionManager;
}

export function shutdownConnectionManager(): void {
  if (connectionManager) {
    connectionManager.shutdown();
  }
}
