import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import * as DatabaseLogger from './database.logger';

export class ConnectionManager {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || process.env.DB_PATH || join(process.cwd(), 'data', 'pulse-trader.db');
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

      DatabaseLogger.logConnection('created', { path: this.dbPath });
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
