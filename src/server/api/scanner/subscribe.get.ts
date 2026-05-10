import { createEventStream } from 'h3'
import { getScannerEngine } from '../../services/scanner-engine'

export default defineEventHandler((event) => {
  const stream = createEventStream(event)
  const engine = getScannerEngine()
  const id     = `sse-${Date.now()}-${Math.random().toString(36).slice(2)}`

  // Write helper — serialises a JSON payload as an SSE data frame
  const write = (data: object) => {
    stream.push({ data: JSON.stringify(data) }).catch(() => {})
  }

  // Register this client so the engine can fan-out row updates
  engine.addSseClient(id, write)

  // Keep-alive ping every 25 s (named event — EventSource.onmessage ignores it)
  const ping = setInterval(() => {
    stream.push({ event: 'ping', data: 'ping' }).catch(() => clearInterval(ping))
  }, 25_000)

  // Unregister + stop ping when the client disconnects
  stream.onClosed(() => {
    clearInterval(ping)
    engine.removeSseClient(id)
  })

  // ── IMPORTANT: call stream.send() FIRST, THEN push data ──────────────────
  // stream.send() starts the HTTP pipe (TransformStream → Node response).
  // Pushing data before send() fills the TransformStream buffer and can stall
  // indefinitely (awaiting a reader that doesn't exist yet).
  const sendPromise = stream.send()

  // Push current cached rows as initial snapshot (non-blocking, fires into pipe)
  const initial = engine.getCachedRows()
  if (initial.length > 0) {
    write({ type: 'snapshot', rows: initial })
  }

  // Tell the client the current server-side WS relay status immediately so the
  // status indicator is accurate from the first frame.
  write({ type: 'wsStatus', status: engine.getWsStatus() })

  return sendPromise
})
