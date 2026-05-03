import { getScannerEngine } from '../../services/scanner-engine'

export default defineEventHandler((event) => {
  const res = event.node.res
  const req = event.node.req

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const engine = getScannerEngine()

  const write = (data: object) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    } catch { /* client gone */ }
  }

  // Send current rows immediately as snapshot
  const initial = engine.getCachedRows()
  if (initial.length > 0) {
    write({ type: 'snapshot', rows: initial })
  }

  // Register SSE client
  const id = `sse-${Date.now()}-${Math.random().toString(36).slice(2)}`
  engine.addSseClient(id, write)

  // Keep-alive ping every 25 s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(ping) }
  }, 25_000)

  const cleanup = () => {
    clearInterval(ping)
    engine.removeSseClient(id)
  }

  req.on('close', cleanup)
  req.on('error', cleanup)

  // Keep the connection open indefinitely
  return new Promise<void>(() => {})
})
