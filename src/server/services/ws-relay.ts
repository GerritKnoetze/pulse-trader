/**
 * WS Relay — manages a single persistent WebSocket connection to massive.com.
 *
 * - Authenticates with API key on connect
 * - Manages per-symbol subscriptions (A = per-second aggregate, Q = quote)
 * - Exponential backoff reconnect (1 s → 30 s, max 10 attempts)
 * - 30-second keep-alive ping
 * - Emits 'tick' events to registered handlers
 */

import { getBrokerCredentials } from './snapshot-cache'

// ── Types ─────────────────────────────────────────────────────────────────────

export type WsStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error'

export interface AggregateTick {
  ev: 'A' | 'AM' | 'T'
  sym: string
  o: number    // open
  h: number    // high
  l: number    // low
  c: number    // close / last price
  v: number    // volume this tick
  av: number   // accumulated volume today
  vw: number   // vwap
  s: number    // start timestamp
  e: number    // end timestamp
  p?: number   // trade price (T events use p instead of c)
  x?: number   // exchange id (T events)
}

export interface QuoteTick {
  ev: 'Q'
  sym: string
  bp: number   // bid price
  ap: number   // ask price
  bs: number   // bid size
  as: number   // ask size
  t: number    // timestamp
}

export type MarketTick = AggregateTick | QuoteTick

export type TickHandler = (tick: MarketTick) => void
export type StatusHandler = (status: WsStatus) => void

// ── WsRelay class ─────────────────────────────────────────────────────────────

class WsRelay {
  private ws: WebSocket | null = null
  private status: WsStatus = 'disconnected'
  private subscriptions = new Set<string>()    // "A.SYM" | "Q.SYM"
  private tickHandlers = new Map<string, TickHandler>()
  private statusHandlers = new Map<string, StatusHandler>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null   // resets backoff only after 15s stable
  private stopping = false


  private readonly RECONNECT_BASE_MS = 1_000
  private readonly RECONNECT_MAX_MS  = 30_000
  private readonly MAX_ATTEMPTS      = 10
  private readonly PING_INTERVAL_MS  = 30_000

  // ── Connection lifecycle ─────────────────────────────────────────────────

  connect(): void {
    // If a previous attempt ended in 'error' (e.g. auth_failed) the underlying
    // socket may still report OPEN — tear it down so a retry performs a full
    // reconnect + re-auth instead of being silently swallowed by the guard below.
    if (this.status === 'error' && this.ws) {
      this.stopPing()
      this.ws.onclose = null
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.stopping = false
    this.setStatus('connecting')

    let creds: { apiKey: string; wsUrl: string }
    try {
      creds = getBrokerCredentials()
    } catch {
      this.setStatus('error')
      return
    }

    const url = `${creds.wsUrl}/stocks`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.setStatus('authenticating')
      // massive.com WS auth uses { action, params } — NOT { action, apiKey }
      this.ws!.send(JSON.stringify({ action: 'auth', params: creds.apiKey }))
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as Array<Record<string, unknown>>
        if (!Array.isArray(data)) return

        for (const msg of data) {
          const ev = msg['ev'] as string
          if (ev === 'status') {
            const msgStatus = msg['status'] as string

            if (msgStatus === 'auth_success') {
              // Auth confirmed — now we can receive market data
              this.setStatus('connected')
              // Reset backoff only after 15 s of stability
              if (this.stableTimer) clearTimeout(this.stableTimer)
              this.stableTimer = setTimeout(() => {
                this.reconnectAttempts = 0
                this.stableTimer = null
              }, 15_000)
              this.startPing()
              // Re-subscribe to any pending subscriptions
              if (this.subscriptions.size > 0) {
                this.sendSubscribe([...this.subscriptions])
              }
            } else if (msgStatus === 'auth_failed') {
              this.setStatus('error')
            }
            continue
          }
          if (ev !== 'status') {
            const tick = msg as unknown as MarketTick
            for (const handler of this.tickHandlers.values()) {
              try { handler(tick) } catch { /* ignore handler errors */ }
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }

    this.ws.onclose = () => {
      this.stopPing()
      // Cancel stable-connection timer — the connection didn't survive long enough
      if (this.stableTimer) { clearTimeout(this.stableTimer); this.stableTimer = null }
      if (!this.stopping) {
        this.setStatus('disconnected')
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      this.setStatus('error')
    }
  }

  disconnect(): void {
    this.stopping = true
    this.stopPing()
    this.clearReconnectTimer()
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  // ── Subscription management ───────────────────────────────────────────────

  /**
   * Subscribe to aggregate (A) and optionally quote (Q) streams for symbols.
   * @param symbols  ticker symbols
   * @param withQuotes  also subscribe to Q (quote) stream — use for tier 1 only
   */
  subscribe(symbols: string[], withQuotes = false): void {
    const params: string[] = []
    for (const sym of symbols) {
      params.push(`A.${sym}`)
      if (withQuotes) params.push(`Q.${sym}`)
      this.subscriptions.add(`A.${sym}`)
      if (withQuotes) this.subscriptions.add(`Q.${sym}`)
    }
    if (params.length > 0) {
      if (this.status === 'connected') {
        this.sendSubscribe(params)
      } else {
        // Connect on-demand — the first scan (and re-scans after a drop) drive
        // connection establishment instead of app boot.
        this.connect()
      }
    }
  }

  unsubscribe(symbols: string[]): void {
    const params: string[] = []
    for (const sym of symbols) {
      for (const prefix of ['A', 'Q']) {
        const key = `${prefix}.${sym}`
        if (this.subscriptions.delete(key)) params.push(key)
      }
    }
    if (params.length > 0 && this.status === 'connected') {
      this.ws?.send(JSON.stringify({ action: 'unsubscribe', params: params.join(',') }))
    }
  }

  /** Replace subscriptions: unsubscribe removed, subscribe added */
  updateSubscriptions(tier1: string[], tier2: string[]): void {
    const desired = new Set<string>()
    for (const s of tier1) { desired.add(`A.${s}`); desired.add(`Q.${s}`) }
    for (const s of tier2) { desired.add(`A.${s}`) }

    const toRemove = [...this.subscriptions].filter(s => !desired.has(s))
    const toAdd    = [...desired].filter(s => !this.subscriptions.has(s))

    if (toRemove.length > 0) {
      toRemove.forEach(s => this.subscriptions.delete(s))
      if (this.status === 'connected') {
        this.ws?.send(JSON.stringify({ action: 'unsubscribe', params: toRemove.join(',') }))
      }
    }
    if (toAdd.length > 0) {
      toAdd.forEach(s => this.subscriptions.add(s))
      if (this.status === 'connected') {
        this.sendSubscribe(toAdd)
      } else {
        // Connect on-demand so live data flows from the first scan onward.
        this.connect()
      }
    }
  }

  // ── Handler registration ──────────────────────────────────────────────────

  onTick(id: string, handler: TickHandler): void { this.tickHandlers.set(id, handler) }
  offTick(id: string): void { this.tickHandlers.delete(id) }
  onStatus(id: string, handler: StatusHandler): void { this.statusHandlers.set(id, handler) }
  offStatus(id: string): void { this.statusHandlers.delete(id) }

  getStatus(): WsStatus { return this.status }
  getSubscriptionCount(): number { return this.subscriptions.size }

  /** True when the symbol's aggregate channel is currently subscribed. */
  isSubscribed(symbol: string): boolean {
    return this.subscriptions.has(`A.${symbol}`)
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private sendSubscribe(params: string[]): void {
    // massive.com accepts comma-separated params in one message
    const BATCH = 100
    for (let i = 0; i < params.length; i += BATCH) {
      const batch = params.slice(i, i + BATCH)
      this.ws?.send(JSON.stringify({ action: 'subscribe', params: batch.join(',') }))
    }
  }

  private setStatus(s: WsStatus): void {
    this.status = s
    for (const handler of this.statusHandlers.values()) {
      try { handler(s) } catch { /* ignore */ }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_ATTEMPTS) return
    const delay = Math.min(
      this.RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      this.RECONNECT_MAX_MS,
    )
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'ping' }))
      }
    }, this.PING_INTERVAL_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global { var __wsRelay: WsRelay | undefined }

export function getWsRelay(): WsRelay {
  if (!globalThis.__wsRelay) globalThis.__wsRelay = new WsRelay()
  return globalThis.__wsRelay
}
