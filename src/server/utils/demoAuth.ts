import type { H3Event } from 'h3'

export const DEMO_TOKEN = 'demo-token-pulse-trader-2026'

export function requireDemoAuth(event: H3Event) {
  const auth = getHeader(event, 'authorization') ?? ''
  if (auth !== `Bearer ${DEMO_TOKEN}`) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: `Invalid or missing bearer token. Expected: Bearer ${DEMO_TOKEN}`,
    })
  }
}
