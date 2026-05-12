import { getScannerEngine } from '../../services/scanner-engine'

export default defineEventHandler(() => {
  try {
    const engine = getScannerEngine()
    const status = engine.getStatus()
    return { success: true, data: status }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw createError({ statusCode: 500, message: msg })
  }
})
