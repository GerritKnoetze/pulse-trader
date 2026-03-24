import type Database from 'better-sqlite3';
import { getConnectionManager } from './connection-manager';
import type { ConnectionManager } from './connection-manager';
import * as DatabaseLogger from './database.logger';

export interface QueryParameters {
  [key: string]: unknown;
}

export abstract class BaseRepository {
  protected connectionManager: ConnectionManager;

  constructor(connectionManager?: ConnectionManager) {
    this.connectionManager = connectionManager || getConnectionManager();
  }

  protected executeQuery<T = unknown>(
    query: string,
    parameters?: QueryParameters,
  ): T[] {
    const db = this.connectionManager.getDatabase();
    try {
      const stmt = db.prepare(query);
      return (parameters ? stmt.all(parameters) : stmt.all()) as T[];
    } catch (error) {
      if (!String((error as Error).message).includes('no such table')) {
        DatabaseLogger.logError(error as Error, {
          operation: 'execute_query',
          query: query.substring(0, 200),
        });
      }
      throw error;
    }
  }

  protected executeRun(
    query: string,
    parameters?: QueryParameters,
  ): Database.RunResult {
    const db = this.connectionManager.getDatabase();
    try {
      const stmt = db.prepare(query);
      return parameters ? stmt.run(parameters) : stmt.run();
    } catch (error) {
      if (!String((error as Error).message).includes('no such table')) {
        DatabaseLogger.logError(error as Error, {
          operation: 'execute_run',
          query: query.substring(0, 200),
        });
      }
      throw error;
    }
  }

  protected executeInTransaction<T>(
    operations: (db: Database.Database) => T,
  ): T {
    const db = this.connectionManager.getDatabase();
    try {
      return db.transaction(operations)(db);
    } catch (error) {
      DatabaseLogger.logError(error as Error, { operation: 'execute_transaction' });
      throw error;
    }
  }

  public healthCheck(): boolean {
    try {
      const result = this.executeQuery<{ ok: number }>('SELECT 1 as ok');
      return result.length > 0;
    } catch {
      return false;
    }
  }
}
