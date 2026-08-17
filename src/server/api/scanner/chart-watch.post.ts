import { getScannerEngine } from '../../services/scanner-engine'

/**
 * POST /api/scanner/chart-watch
 * Body: { symbol: string, action: 'watch' | 'unwatch' }
 *
 * Registers/unregisters a chart tab's symbol with the data layer so it keeps
 * the symbol's series fresh on every new period and pushes new candles to the
 * chart as SSE bar events.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event) as { symbol?: string; action?: string }
  const symbol = body?.symbol?.toUpperCase()
  const action = body?.action

  if (!symbol || (action !== 'watch' && action !== 'unwatch')) {
    throw createError({ statusCode: 400, message: 'symbol and action ("watch" | "unwatch") are required' })
  }

  const engine = getScannerEngine()
  if (action === 'watch') engine.watchSymbol(symbol)
  else engine.unwatchSymbol(symbol)

  return { success: true }
})
