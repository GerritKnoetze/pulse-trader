import { restClient } from '@massive.com/client-js'
import { SettingsRepository } from '../../database/repositories/settings-repository'
import { decryptJsonFields } from '../../utils/encryption'

interface StepEvent {
  type: 'step'
  id:   'config' | 'api' | 'ws'
  status: 'running' | 'success' | 'error'
  msg:  string
}

interface DoneEvent {
  type:    'done'
  overall: 'success' | 'error'
}

export default defineEventHandler(async (event) => {
  const res = event.node.res
  const req = event.node.req

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  let closed = false
  req.on('close', () => { closed = true })

  const send = (data: StepEvent | DoneEvent) => {
    if (closed) return
    try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch { closed = true }
  }

  // ── Step 0: load + decrypt settings ───────────────────────────────────────
  let apiKey = '', apiUrl = '', wsUrl = ''
  try {
    const repo = new SettingsRepository()
    const raw  = repo.getValue('data-broker-details')
    if (!raw) throw new Error('Data broker not configured — save your settings first')
    const details  = JSON.parse(raw) as Record<string, unknown>
    const decrypted = decryptJsonFields('data-broker-details', details)
    apiKey = (decrypted.apiKey as string) ?? ''
    apiUrl = (decrypted.apiUrl as string) || 'https://api.massive.com'
    wsUrl  = (decrypted.wsUrl  as string) || 'wss://socket.massive.com'
    if (!apiKey) throw new Error('API key is empty — enter your Massive API key first')
    send({ type: 'step', id: 'config', status: 'success', msg: `Settings loaded — API: ${apiUrl}  WS: ${wsUrl}` })
  } catch (err) {
    send({ type: 'step', id: 'config', status: 'error', msg: String(err) })
    send({ type: 'done', overall: 'error' })
    res.end()
    return
  }

  // ── Step 1: REST API test ──────────────────────────────────────────────────
  send({ type: 'step', id: 'api', status: 'running', msg: `Connecting to REST API at ${apiUrl}…` })
  let apiOk = false
  try {
    const client = restClient(apiKey, apiUrl)
    // Simple validated request: 1 daily bar for AAPL
    const response = await client.getStocksAggregates({
      stocksTicker: 'AAPL',
      multiplier:   '1',
      timespan:     'day',
      from:         '2025-01-02',
      to:           '2025-01-02',
      limit:        '1',
    }) as Record<string, unknown>

    const status  = (response?.status  ?? (response?.data as Record<string,unknown>)?.status)  as string | undefined
    const results = (response?.results ?? (response?.data as Record<string,unknown>)?.results) as unknown[]
    const count   = Array.isArray(results) ? results.length : 0

    if (status === 'OK') {
      apiOk = true
      send({ type: 'step', id: 'api', status: 'success', msg: `REST API OK — status: ${status}, ${count} bar(s) returned for AAPL` })
    } else {
      send({ type: 'step', id: 'api', status: 'error', msg: `Unexpected response status: "${status ?? 'none'}" — check API key / plan` })
    }
  } catch (err) {
    send({ type: 'step', id: 'api', status: 'error', msg: `REST API request failed: ${String(err).slice(0, 200)}` })
  }

  // ── Step 2: WebSocket test ─────────────────────────────────────────────────
  send({ type: 'step', id: 'ws', status: 'running', msg: `Opening WebSocket at ${wsUrl}/stocks…` })
  let wsOk = false
  await new Promise<void>((resolve) => {
    const TIMEOUT_MS = 12_000
    let settled = false

    const finish = (ok: boolean, msg: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      wsOk = ok
      send({ type: 'step', id: 'ws', status: ok ? 'success' : 'error', msg })
      resolve()
    }

    const timer = setTimeout(() => {
      try { ws.close() } catch { /* ignore */ }
      finish(false, 'WebSocket timed out after 12 seconds — server unreachable or wrong URL')
    }, TIMEOUT_MS)

    let ws: WebSocket
    try {
      ws = new WebSocket(`${wsUrl}/stocks`)
    } catch (err) {
      finish(false, `Failed to create WebSocket: ${String(err)}`)
      return
    }

    ws.onopen = () => {
      send({ type: 'step', id: 'ws', status: 'running', msg: 'TCP connected — sending auth…' })
      try {
        ws.send(JSON.stringify({ action: 'auth', params: apiKey }))
      } catch (err) {
        finish(false, `Failed to send auth: ${String(err)}`)
      }
    }

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data as string) as Array<Record<string, unknown>>
        const msgs = Array.isArray(data) ? data : [data]
        for (const m of msgs) {
          if (m['ev'] !== 'status') continue
          const s = m['status'] as string
          if (s === 'connected') {
            send({ type: 'step', id: 'ws', status: 'running', msg: 'Handshake accepted — waiting for auth response…' })
          } else if (s === 'auth_success') {
            try { ws.close() } catch { /* ignore */ }
            finish(true, `WebSocket authenticated — ${m['message'] ?? 'auth_success'}`)
          } else if (s === 'auth_failed') {
            try { ws.close() } catch { /* ignore */ }
            finish(false, `WebSocket auth failed: ${m['message'] ?? 'invalid API key'}`)
          }
        }
      } catch { /* ignore parse errors */ }
    }

    ws.onerror = () => {
      finish(false, `WebSocket connection error — check WS URL and network connectivity`)
    }

    ws.onclose = () => {
      if (!settled) finish(false, 'WebSocket closed before authentication completed')
    }
  })

  send({ type: 'done', overall: (apiOk && wsOk) ? 'success' : 'error' })
  res.end()
})
