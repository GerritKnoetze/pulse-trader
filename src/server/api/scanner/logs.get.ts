import { getLogBuffer, addLogClient, removeLogClient } from '../../services/app-log'
import type { AppLogEntry } from '../../services/app-log'

export default defineEventHandler((event) => {
  const res = event.node.res
  const req = event.node.req

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const write = (entry: AppLogEntry) => {
    try {
      res.write(`data: ${JSON.stringify(entry)}\n\n`)
    } catch { /* client gone */ }
  }

  // Send buffered history immediately so the console is pre-populated
  const history = getLogBuffer()
  if (history.length > 0) {
    try {
      res.write(`data: ${JSON.stringify({ type: 'history', entries: history })}\n\n`)
    } catch { return }
  }

  const id = `log-sse-${Date.now()}-${Math.random().toString(36).slice(2)}`
  addLogClient(id, write)

  // Keep-alive ping every 25 s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(ping) }
  }, 25_000)

  const cleanup = () => {
    clearInterval(ping)
    removeLogClient(id)
  }

  req.on('close', cleanup)
  req.on('error', cleanup)

  return new Promise<void>(() => {})
})
