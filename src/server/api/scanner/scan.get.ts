import type { ScanCriteria } from '../../../app/types/scanner'
import { getScannerEngine } from '../../services/scanner-engine'

export default defineEventHandler(async (event) => {
  try {
    const q = getQuery(event) as Record<string, string>

    const criteria: ScanCriteria = {
      minPrice:         q.minPrice         ? Number(q.minPrice)         : undefined,
      maxPrice:         q.maxPrice         ? Number(q.maxPrice)         : undefined,
      minChangePercent: q.minChangePercent ? Number(q.minChangePercent) : undefined,
      maxChangePercent: q.maxChangePercent ? Number(q.maxChangePercent) : undefined,
      minVolume:        q.minVolume        ? Number(q.minVolume)        : undefined,
      minRvol:          q.minRvol          ? Number(q.minRvol)          : undefined,
    }

    const cursor = q.cursor ?? null
    const limit  = Math.min(Math.max(Number(q.limit) || 50, 1), 200)

    const engine = getScannerEngine()
    const result = await engine.scan(criteria, cursor, limit)

    return { success: true, ...result }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw createError({ statusCode: 500, message: msg })
  }
})
