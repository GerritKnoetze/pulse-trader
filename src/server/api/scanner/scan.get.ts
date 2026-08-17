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

    const visible = Math.min(Math.max(Number(q.visible) || 50, 10), 300)

    const engine = getScannerEngine()
    const result = await engine.scan(criteria, visible)

    return { success: true, ...result }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw createError({ statusCode: 500, message: msg })
  }
})
