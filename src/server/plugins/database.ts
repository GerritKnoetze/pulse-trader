import { getConnectionManager, shutdownConnectionManager } from '../database/connection-manager';
import { getScannerEngine } from '../services/scanner-engine';
import { getWsRelay } from '../services/ws-relay';

export default defineNitroPlugin(async (nitroApp) => {
  // Initialize database connection
  getConnectionManager();

  // Initialize scanner services (singletons created on first access)
  // Attempt to connect WS relay; it will retry automatically if settings aren't configured yet
  try {
    getScannerEngine(); // registers WS tick handler
    getWsRelay().connect();
  } catch {
    // Settings not configured yet — WS will connect when scanner is first used
  }

  // Graceful shutdown
  nitroApp.hooks.hook('close', () => {
    shutdownConnectionManager();
    getWsRelay().disconnect();
  });
});
