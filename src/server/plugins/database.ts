import { getConnectionManager, shutdownConnectionManager } from '../database/connection-manager';

export default defineNitroPlugin(async (nitroApp) => {
  // Initialize connection
  getConnectionManager();

  // Graceful shutdown
  nitroApp.hooks.hook('close', () => {
    shutdownConnectionManager();
  });
});
