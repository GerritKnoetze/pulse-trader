import { getScannerEngine } from '../../services/scanner-engine'

/**
 * POST /api/scanner/chart-refresh
 * Body: { symbol: string }
 *
 * Forces a full re-sync of the symbol's 1-min / 5-min / daily series from the
 * data provider (bypassing period-elapse staleness gates), updates cache/DB and
 * pushes the complete fresh series to the open chart via SSE bar events.
 * Returns the bar counts per timespan.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event) as { symbol?: string }
  const symbol = body?.symbol?.toUpperCase()
  if (!symbol) throw createError({ statusCode: 400, message: 'symbol is required' })

  const engine = getScannerEngine()
  const counts = await engine.forceRefreshSymbol(symbol)

  return { success: true, ...counts }
})
