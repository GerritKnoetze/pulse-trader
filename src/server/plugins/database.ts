import { getConnectionManager, shutdownConnectionManager } from '../database/connection-manager';
import { getScannerEngine } from '../services/scanner-engine';
import { getWsRelay } from '../services/ws-relay';

export default defineNitroPlugin(async (nitroApp) => {
  // Initialize database connection
  getConnectionManager();

  // Initialize scanner services (singletons created on first access)
  // NOTE: the WS relay is deliberately NOT connected here — the app boots with
  // zero upstream data activity. connect() happens on-demand from the first
  // scan (ws-relay updateSubscriptions/subscribe).
  try {
    getScannerEngine(); // registers WS tick handler
  } catch {
    // Settings not configured yet — WS will connect when scanner is first used
  }

  // Graceful shutdown
  nitroApp.hooks.hook('close', () => {
    shutdownConnectionManager();
    getWsRelay().disconnect();
  });
});
