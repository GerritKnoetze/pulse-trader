/**
 * Lightweight database logger — console only, no external dependencies.
 * Keeps pulse-trader lean. Swap for a structured logger later if needed.
 */

const PREFIX = '[db]';

export function logConnection(action: string, details?: Record<string, unknown>): void {
  const extra = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`${PREFIX} ${action}${extra}`);
}

export function logQuery(
  query: string,
  _parameters?: Record<string, unknown>,
  _duration?: number,
): void {
  // Disabled by default to reduce noise — uncomment for debugging
  // console.debug(`${PREFIX} query: ${query.substring(0, 200)}`);
}

export function logError(error: Error, context?: Record<string, unknown>): void {
  console.error(`${PREFIX} ERROR: ${error.message}`, context ?? '', error.stack ?? '');
}
