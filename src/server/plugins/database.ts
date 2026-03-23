import { join } from 'path';
import { getConnectionManager, shutdownConnectionManager } from '../database/connection-manager';
import { MigrationManager } from '../database/migration-manager';
import * as DatabaseLogger from '../database/database.logger';

export default defineNitroPlugin(async (nitroApp) => {
  try {
    // Initialize connection
    const cm = getConnectionManager();
    DatabaseLogger.logConnection('initialized', cm.getStatus());

    // Run pending migrations automatically
    const migrationsDir = join(process.cwd(), 'src', 'server', 'database', 'migrations');
    const migrationManager = new MigrationManager(migrationsDir, cm);
    await migrationManager.migrateUp();

    const status = await migrationManager.getStatus();
    DatabaseLogger.logConnection('migrations ready', {
      applied: status.totalApplied,
      pending: status.totalPending,
    });
  } catch (error) {
    DatabaseLogger.logError(error as Error, { operation: 'nitro_plugin_init' });
    throw error;
  }

  // Graceful shutdown
  nitroApp.hooks.hook('close', () => {
    shutdownConnectionManager();
  });
});
