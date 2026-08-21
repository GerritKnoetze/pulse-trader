/**
 * Scanner Engine — orchestrates the full scan pipeline:
 *
 * 1. Fetch full-market snapshot (cached 60 s)
 * 2. Apply ScanCriteria (price, change%, volume) → filtered candidate set
 * 3. Sort candidates by |changePercent| DESC
 * 4. For the requested page: fetch/get-cached bars per ticker (L1→L2→L3)
 *    - Daily bars: permanent in SQLite, incremental delta from API
 *    - 1-min bars: rolling intraday window in SQLite, incremental delta
 *    - W/M/Q/Y derived from daily; 5/15/30/60 derived from 1-min (in memory)
 * 5. Compute all TA fields (ATR, CC codes, pattern, signal, category, MTF, FTFC, inForce)
 * 6. Maintain in-memory row cache → powers SSE live-update fan-out
 * 7. Update WS subscriptions: tier 1 (top-50 A+Q), tier 2 (51-200 A only)
 * 8. WS AM (per-minute) events persist 1-min bars to SQLite + CandleCache in real-time
 */

import type { ScannerRow, MtfSignal, StratSetup } from '../../app/types/scanner'
import type { ScanCriteria } from '../../app/types/scanner'
import { scoreSetup } from './strat-setup-engine'
import type { SnapshotTicker } from './snapshot-cache'
import type { BarInput } from '../database/repositories/market-data-repository'
import type { AggregateTick } from './ws-relay'
import { getSnapshotCache } from './snapshot-cache'
import { getCandleCache } from './candle-cache'
import { computeTA, computeRVOL, computeFTFC, computeMtfState, computeCcCodes, computePattern, aggregateTo5min, aggregateTo15min, aggregateTo30min, aggregateTo60min, type TodaySnap } from './ta-calculator'
import { getWsRelay } from './ws-relay'
import { getOrSyncDailyBars, getOrSyncMinuteBars, getOrSyncFiveMinuteBars, getOrSyncTenSecondBars, persistMinuteBar, persistTenSecondBar, TEN_SEC_BUFFER, RateLimitError } from './market-data.service'
import { getMetrics } from './metrics'
import { isMarketSession, etDateString } from '../utils/et-time'
import { appLog } from './app-log'

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_CONCURRENCY = 10   // parallel bar fetches per scan page

// Period lengths used by the period-elapse freshness check.
const MINUTE_MS       = 60_000
const FIVE_MINUTE_MS  = 5 * MINUTE_MS
const DAY_MS          = 24 * 60 * MINUTE_MS

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScanPage {
  rows: ScannerRow[]
  total: number          // total tickers matching criteria (before pagination)
  nextCursor: string | null
  universeCount: number  // total snapshot tickers examined
  lastScan: string       // ISO timestamp
}

type SseWriter = (data: object) => void

// Per-symbol intraday live state updated by WS ticks
interface IntradayState {
  '1':  MtfSignal
  '5':  MtfSignal
  'D'?: MtfSignal  // updated on every AM tick
  'W'?: MtfSignal  // updated on every AM tick from daily cache
  'M'?: MtfSignal
  'Q'?: MtfSignal
  'Y'?: MtfSignal
  // live price/volume data
  lastPrice?: number
  accVolume?: number
  // today's session open (from snapshot ticker.day.o) — used to derive live D direction
  todayOpen?: number
  // previous session close — stored at scan time, used to compute live chg$/chg%
  prevDayClose?: number
}

// ── Engine ────────────────────────────────────────────────────────────────────

class ScannerEngine {
  // Row cache: symbol → ScannerRow (updated by scans and WS ticks)
  private rowCache = new Map<string, ScannerRow>()

  // SSE clients
  private sseClients = new Map<string, SseWriter>()

  // Alert deduplication: key = `${symbol}-${signalTf}-${combo}`
  private alertsSent = new Set<string>()

  // Alerts are DISABLED for now (2026-08-21) to reduce noise while the data
  // layer is the focus. All alert code remains in place — flip `alertsEnabled`
  // to `true` to re-enable setup-alert emission (SSE `setupAlert` frames).
  private readonly alertsEnabled = false

  // Intraday data from WS (updated every tick)
  private intraday = new Map<string, IntradayState>()

  // In-progress 10-second candle per symbol (ephemeral — derived from the WS
  // per-second `A` aggregates, never persisted). Finalized buckets are stored in
  // the CandleCache '10s' entry and broadcast to open charts.
  private tenSec = new Map<string, BarInput>()

  // Last scan metadata
  private lastScanAt: string = ''
  private lastCriteria: ScanCriteria | null = null

  // symbol → last computed avgVol30 (from TA). Used to pre-filter minRvol in
  // the snapshot filter so enrichment is not wasted on rows that will be
  // dropped by the post-enrichment rvol filter.
  private avgVol30Cache = new Map<string, number>()

  // Symbols with an open chart tab. The data layer keeps these fresh on every
  // new period and pushes the new bars to charts as SSE events (no polling).
  private watchedSymbols = new Set<string>()

  // Symbols with a one-shot chart backfill already in flight (dedup so repeated
  // chart-bars calls for the same symbol never spawn concurrent seed fetches).
  private seeding = new Set<string>()

  // Tickers of the current visible grid window — the live WS streams A+Q for
  // these (plus watched symbols). Replaced on every scan.
  private lastVisibleTickers: string[] = []

  // Last bar timestamp broadcast per `${symbol}:${timespan}` — only the newly
  // completed bars (deltas) are pushed to charts.
  private lastSentBar = new Map<string, number>()

  // ET calendar day each watched symbol was last daily-refreshed (daily closed
  // candles only change once per day, so skip the daily DB sync otherwise).
  private lastDailyDay = new Map<string, string>()

  private periodTimer: ReturnType<typeof setTimeout> | null = null
  private refreshingWatched = false

  // Symbols whose TA has already been computed this session — enrichment is
  // only scheduled for symbols missing from this set (dedup across refreshes).
  private enrichedSymbols = new Set<string>()

  // Symbols dropped by the authoritative minRvol filter — excluded from the
  // visible window so they never reappear as unenriched minimal rows.
  private rejectedSymbols = new Set<string>()

  // Background enrichment of the visible window (never awaited).
  private progressiveGeneration = 0
  private progressiveActive = false

  constructor() {
    // Wire the WS tick handler so live A/AM/T ticks patch rows + charts. The
    // relay connects on demand on the first subscription request.
    getWsRelay().onTick('scanner-engine', (tick) => this.onTick(tick as AggregateTick))

    // Log WS status changes and fan-out to SSE clients so the browser status
    // indicator accurately reflects the server-side WS relay state.
    let disconnectLogTimer: ReturnType<typeof setTimeout> | null = null
    getWsRelay().onStatus('scanner-engine-log', (status) => {
      if (disconnectLogTimer) { clearTimeout(disconnectLogTimer); disconnectLogTimer = null }
      if (status === 'connected') {
        appLog('WS connected — live ticks active', 'info',
          `Subscriptions: ${getWsRelay().getSubscriptionCount()} channels | SSE clients: ${this.sseClients.size} | RowCache: ${this.rowCache.size} rows`)
        this.broadcastStatus(status)
      } else if (status === 'error') {
        appLog('WS error — check API key / network', 'error',
          `SSE clients: ${this.sseClients.size} | RowCache: ${this.rowCache.size} rows (stale) | Check API key in Settings → Data Provider`)
        this.broadcastStatus(status)
      } else if (status === 'disconnected') {
        disconnectLogTimer = setTimeout(() => {
          disconnectLogTimer = null
          appLog('WS disconnected', 'warn',
            `Subscriptions lost: ${getWsRelay().getSubscriptionCount()} channels | SSE clients: ${this.sseClients.size} | Reconnecting with exponential backoff (1 s → 30 s max)`)
          this.broadcastStatus('disconnected')
        }, 3_000)
      }
      // 'connecting' and 'authenticating' intentionally not logged / broadcast
    })

    // Period-elapse refresh for watched chart symbols: on every new minute the
    // data layer advances the cache/DB and pushes the new candles to open charts
    // as SSE bar events.
    this.schedulePeriodRefresh()

  }

  // ── Public API ──────────────────────────────────────────────────────────

   /**
    * Run a scan: re-filter the cached universe and return the top `visible`
    * matched symbols as rows — instant, since unenriched rows are minimal
    * snapshot rows with no bar fetches. Enrichment of the visible window runs
    * in the background: symbols new to the window get enriched, already
    * enriched ones are served from the row cache.
    * @param criteria filter parameters
    * @param visible  number of top matches to show in the grid
    */
   async scan(criteria: ScanCriteria, visible: number): Promise<ScanPage> {
     const scanStart = Date.now()
     getMetrics().increment('scans')

     const snapshot = await getSnapshotCache().getSnapshot()
     // Deduplicate by ticker (API can return the same symbol from multiple exchanges)
     const seen = new Set<string>()
     const unique = snapshot.filter(t => { if (seen.has(t.ticker)) return false; seen.add(t.ticker); return true })
     const candidates = filterSnapshot(unique, criteria, this.avgVol30Cache)

     // Sort by |change%| descending so biggest movers are first
     candidates.sort((a, b) => Math.abs(b.todaysChangePerc) - Math.abs(a.todaysChangePerc))

     this.lastCriteria = criteria

     // Visible window: top `visible` matches, excluding minRvol-rejected symbols.
     const window = candidates.slice(0, visible).filter(c => !this.rejectedSymbols.has(c.ticker))

     // Pre-populate prevDayClose for the visible symbols (the ones that will be
     // streamed) so onTick can compute live chg$ / chg% without snapshot data.
     for (const t of window) {
       let state = this.intraday.get(t.ticker)
       if (!state) {
         state = { '1': 'up', '5': 'up' }
         this.intraday.set(t.ticker, state)
       }
       if (t.prevDay.c) state.prevDayClose = t.prevDay.c
     }

     // Build rows instantly — enriched from the row cache when available,
     // otherwise a minimal snapshot row. No bar fetches on this path.
     const rows: ScannerRow[] = []
     for (const t of window) {
       const row = this.rowCache.get(t.ticker) ?? this.buildMinimalRow(t)
       if (row) {
         // Refresh today's session daily bar from the fresh snapshot each scan.
         if (t.day && t.day.o > 0) {
           row.day = { o: t.day.o, h: t.day.h, l: t.day.l, c: t.day.c }
         }
         rows.push(row)
       }
     }

     // Update WS subscriptions to match the visible grid rows (+ open chart
     // symbols). Symbols that dropped out of the window are unsubscribed.
     this.lastVisibleTickers = window.map(t => t.ticker)
     this.updateWsSubscriptions()

     // Refresh wsActive on all returned rows to reflect the just-made subscriptions.
     for (const row of rows) row.wsActive = this.isWsActive(row.symbol)

     this.lastScanAt = new Date().toISOString()

     appLog(`Scan — ${rows.length} rows in grid (matched ${candidates.length.toLocaleString()})`, 'info',
       `Universe: ${snapshot.length.toLocaleString()} | Visible: ${window.length} | Total duration: ${Date.now() - scanStart} ms | RowCache: ${this.rowCache.size} rows | SSE clients: ${this.sseClients.size}`)

     // Enrich any visible symbols missing enrichment (background, top-down).
     this.enrichVisible(candidates, visible)

     return {
       rows,
       total: candidates.length,
       nextCursor: candidates.length > window.length ? 'more' : null,
       universeCount: snapshot.length,
       lastScan: this.lastScanAt,
     }
   }

  getCachedRows(): ScannerRow[] { return [...this.rowCache.values()] }

  /** Drop the in-memory scanner row cache (rows re-enrich on the next scan). */
  clearRowCache(): number {
    const n = this.rowCache.size
    this.rowCache.clear()
    return n
  }

  /** View of the live intraday WS state for the data-management view. */
  getIntradaySnapshot(): Array<{
    symbol: string
    lastPrice?: number
    accVolume?: number
    todayOpen?: number
    prevDayClose?: number
    dir1?: MtfSignal
    dir5?: MtfSignal
    dirD?: MtfSignal
    dirW?: MtfSignal
    dirM?: MtfSignal
    dirQ?: MtfSignal
    dirY?: MtfSignal
  }> {
    return [...this.intraday.entries()].map(([symbol, s]) => ({
      symbol,
      lastPrice: s.lastPrice,
      accVolume: s.accVolume,
      todayOpen: s.todayOpen,
      prevDayClose: s.prevDayClose,
      dir1: s['1'],
      dir5: s['5'],
      dirD: s['D'],
      dirW: s['W'],
      dirM: s['M'],
      dirQ: s['Q'],
      dirY: s['Y'],
    }))
  }

  /** Current in-progress 10-second candle buckets (ephemeral, never persisted). */
  getTenSecSnapshot(): BarInput[] {
    return [...this.tenSec.values()]
  }

  getActiveSetups(): StratSetup[] {
    return [...this.rowCache.values()]
      .filter(r => r.setup != null)
      .map(r => r.setup!)
  }

  getWsStatus(): string { return getWsRelay().getStatus() }

  getStatus() {
    return {
      wsStatus:        getWsRelay().getStatus(),
      wsSubscriptions: getWsRelay().getSubscriptionCount(),
      cachedRows:      this.rowCache.size,
      sseClients:      this.sseClients.size,
      lastScan:        this.lastScanAt,
      metrics:         getMetrics().snapshot,
    }
  }

  /**
   * Register a symbol whose chart tab is open. The data layer keeps its series
   * fresh on each new period and broadcasts the new bars via SSE. An immediate
   * background refresh (plus initial bar broadcast) runs right away.
   */
  watchSymbol(symbol: string): void {
    this.watchedSymbols.add(symbol)
    // One-shot backfill right away (deduped by the seeding guard, so a
    // concurrent chart-bars seed and this watch share a single fetch).
    this.seedSymbolBars(symbol)
    // Subscribe the symbol on the live relay right away (not just on the next scan).
    if (this.lastVisibleTickers.length > 0) this.updateWsSubscriptions()
  }

  /** Unregister a symbol when its chart tab is closed. */
  unwatchSymbol(symbol: string): void {
    this.watchedSymbols.delete(symbol)
    // Release its WS channel now if it's no longer in the visible grid window.
    if (this.lastVisibleTickers.length > 0) this.updateWsSubscriptions()
  }

  getWatchedSymbols(): string[] {
    return [...this.watchedSymbols]
  }

  /**
   * Force a full re-sync of one symbol's series from the data provider —
   * bypassing the period-elapse staleness gates — updates cache/DB and pushes
   * the complete fresh series to the chart via SSE bar events.
   * Returns bar counts per timespan.
   */
  async forceRefreshSymbol(symbol: string): Promise<{ minute: number; fiveMin: number; day: number }> {
    const counts = { minute: 0, fiveMin: 0, day: 0 }

    try {
      const minuteBars = await getOrSyncMinuteBars(symbol)
      if (minuteBars.length > 0) {
        getCandleCache().set(symbol, 'minute', minuteBars)
        counts.minute = minuteBars.length
        this.lastSentBar.set(`${symbol}:minute`, minuteBars[minuteBars.length - 1]!.timestamp)
        this.broadcastBars(symbol, 'minute', minuteBars)
      }
    } catch { /* non-critical */ }

    try {
      const fiveBars = await getOrSyncFiveMinuteBars(symbol)
      if (fiveBars.length > 0) {
        getCandleCache().set(symbol, '5min', fiveBars)
        counts.fiveMin = fiveBars.length
        this.lastSentBar.set(`${symbol}:5min`, fiveBars[fiveBars.length - 1]!.timestamp)
        this.broadcastBars(symbol, '5min', fiveBars)
      }
    } catch { /* non-critical */ }

    try {
      const dailyBars = await getOrSyncDailyBars(symbol)
      if (dailyBars.length > 0) {
        getCandleCache().set(symbol, 'day', dailyBars)
        counts.day = dailyBars.length
        this.lastSentBar.set(`${symbol}:day`, dailyBars[dailyBars.length - 1]!.timestamp)
        this.broadcastBars(symbol, 'day', dailyBars)
      }
    } catch { /* non-critical */ }

    this.lastDailyDay.set(symbol, etDateString(Date.now()))
    return counts
  }

  /**
   * One-shot background backfill for a chart symbol (used by chart-bars so a
   * chart open NEVER blocks on the network). Refetches every period-elapsed /
   * missing series (10s → minute → 5min → daily), updates cache/DB and pushes
   * the bars to open SSE clients as `bars` events. Deduplicated per symbol;
   * the period-elapse timer keeps watched symbols current afterwards.
   */
  seedSymbolBars(symbol: string): void {
    if (this.seeding.has(symbol)) return
    this.seeding.add(symbol)
    void this.refreshSymbolBars(symbol)
      .catch(() => { /* non-critical — a later refresh/scan will retry */ })
      .finally(() => { this.seeding.delete(symbol) })
  }

  // ── Private: watched-symbol period refresh ───────────────────────────────

  private schedulePeriodRefresh(): void {
    const now = Date.now()
    const delay = 60_000 - (now % 60_000) + 300
    this.periodTimer = setTimeout(() => {
      if (this.watchedSymbols.size > 0) void this.refreshWatchedSymbols()
      this.schedulePeriodRefresh()
    }, delay)
  }

  private async refreshWatchedSymbols(): Promise<void> {
    if (this.refreshingWatched) return
    this.refreshingWatched = true
    try {
      const targets = [...this.watchedSymbols]
      const concurrency = Math.min(4, targets.length)
      let next = 0
      const worker = async () => {
        while (next < targets.length) {
          const sym = targets[next++]!
          await this.refreshSymbolBars(sym)
        }
      }
      await Promise.all(Array.from({ length: concurrency }, worker))
    } finally {
      this.refreshingWatched = false
    }
  }

  /**
   * Refetch each period-elapsed series for one watched symbol (updates
   * cache/DB) and broadcast only the newly completed bars as SSE events.
   */
  private async refreshSymbolBars(symbol: string): Promise<void> {
    // 10-second — seed history from REST first (so the 10S chart fills quickly,
    // not after the heavier minute/5m/daily syncs). Live buckets are broadcast
    // separately by finalizeTenSecond.
    try {
      const { bars: tenBars, seeded } = await getOrSyncTenSecondBars(symbol)
      const key = `${symbol}:10s`
      // A fresh seed must broadcast the FULL history — resetting the watermark
      // would otherwise filter it out because live buckets already advanced it.
      if (seeded) this.lastSentBar.set(key, 0)
      const last = this.lastSentBar.get(key) ?? 0
      const fresh = tenBars.filter(b => b.timestamp > last)
      if (fresh.length > 0) {
        this.lastSentBar.set(key, fresh[fresh.length - 1]!.timestamp)
        this.broadcastBars(symbol, '10s', fresh)
      }
    } catch { /* non-critical */ }

    // 1-minute — the primary driver of chart updates.
    try {
      const minuteBars = await this.getIntradayBars(symbol)
      const key = `${symbol}:minute`
      const last = this.lastSentBar.get(key) ?? 0
      const fresh = minuteBars.filter(b => b.timestamp > last)
      if (fresh.length > 0) {
        this.lastSentBar.set(key, fresh[fresh.length - 1]!.timestamp)
        this.broadcastBars(symbol, 'minute', fresh)
      }
    } catch { /* non-critical */ }

    // 5-minute — internally period-gated, so it only fetches when a 5m bucket elapsed.
    try {
      const fiveBars = await this.getFiveMinuteBars(symbol)
      const key = `${symbol}:5min`
      const last = this.lastSentBar.get(key) ?? 0
      const fresh = fiveBars.filter(b => b.timestamp > last)
      if (fresh.length > 0) {
        this.lastSentBar.set(key, fresh[fresh.length - 1]!.timestamp)
        this.broadcastBars(symbol, '5min', fresh)
      }
    } catch { /* non-critical */ }

    // Daily — once per ET day (closed candles only change at the day boundary).
    const day = etDateString(Date.now())
    if (this.lastDailyDay.get(symbol) !== day) {
      this.lastDailyDay.set(symbol, day)
      try {
        const dailyBars = await this.getDailyBars(symbol)
        const key = `${symbol}:day`
        const last = this.lastSentBar.get(key) ?? 0
        const fresh = dailyBars.filter(b => b.timestamp > last)
        if (fresh.length > 0) {
          this.lastSentBar.set(key, fresh[fresh.length - 1]!.timestamp)
          this.broadcastBars(symbol, 'day', fresh)
        }
      } catch { /* non-critical */ }
    }
  }

  private broadcastBars(symbol: string, timespan: string, bars: BarInput[]): void {
    const payload = {
      type: 'bars',
      symbol,
      timespan,
      bars: bars.map(b => ({ t: b.timestamp, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume })),
    }
    for (const writer of this.sseClients.values()) {
      try { writer(payload) } catch { /* ignore disconnected clients */ }
    }
  }

  addSseClient(id: string, writer: SseWriter): void { this.sseClients.set(id, writer) }
  removeSseClient(id: string): void { this.sseClients.delete(id) }

  // ── Private: enrichment ──────────────────────────────────────────────────

  /**
   * Work-stealing enrichment pool. Calls `onRow` the moment each row completes
   * so background workers can stream rows via SSE as they finish.
   */
  private async enrichWithCallbacks(
    candidates: SnapshotTicker[],
    onRow: (row: ScannerRow) => void,
  ): Promise<ScannerRow[]> {
    const results: (ScannerRow | null)[] = new Array(candidates.length).fill(null)
    let nextIdx = 0
    const worker = async () => {
      while (nextIdx < candidates.length) {
        const i = nextIdx++
        const row = await this.enrichTicker(candidates[i]!)
        if (row) onRow(row)
        results[i] = row
      }
    }
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENCY, candidates.length) },
      worker,
    )
    await Promise.all(workers)
    return results.filter((r): r is ScannerRow => r !== null)
  }

  /**
   * Background enrichment of the visible window (never awaited). Only symbols
   * missing enrichment are processed; completed rows stream via SSE. Rows that
   * fail the authoritative minRvol filter (needs bar data) are rejected — they
   * are dropped from the grid via a `rowRemoved` frame and excluded from future
   * visible windows. A new scan bumps `progressiveGeneration`, invalidating an
   * in-flight run's broadcasts.
   */
  private enrichVisible(candidates: SnapshotTicker[], visible: number): void {
    const targets = candidates
      .slice(0, visible)
      .filter(c => !this.enrichedSymbols.has(c.ticker) && !this.rejectedSymbols.has(c.ticker))
    if (targets.length === 0) return
    const gen = ++this.progressiveGeneration
    this.progressiveActive = true
    void this.enrichWithCallbacks(targets, (row) => {
      if (gen !== this.progressiveGeneration) return
      this.enrichedSymbols.add(row.symbol)
      getMetrics().increment('scanEnrichedRows')
      const c = this.lastCriteria
      if (c?.minRvol != null && row.rvol < c.minRvol) {
        this.rejectedSymbols.add(row.symbol)
        this.rowCache.delete(row.symbol)
        this.broadcastRowRemoved(row.symbol)
        return
      }
      this.rowCache.set(row.symbol, row)
      getMetrics().increment('scanProgressiveRows')
      this.broadcastUpdate(row)
    }).finally(() => {
      if (gen === this.progressiveGeneration) this.progressiveActive = false
    })
  }

  private async enrichTicker(ticker: SnapshotTicker): Promise<ScannerRow | null> {
    // Track whether any upstream fetch was rate-limited so the Data column can
    // flag the symbol instead of silently showing a degraded row.
    let rateLimited = false
    try {
      const dailyBars = await this.getDailyBars(ticker.ticker)
      if (dailyBars.length < 2) {
        const lastDate = dailyBars.length > 0
          ? new Date(dailyBars[dailyBars.length - 1]!.timestamp).toISOString().slice(0, 10)
          : 'none'
        appLog(`${ticker.ticker}: insufficient daily bars (${dailyBars.length}) — skipped`, 'warn',
          `Required: ≥2 bars | Available: ${dailyBars.length} | Last bar date: ${lastDate} | Possibly a new listing or delisted symbol`)
        return null
      }

      // Minute bars are optional — a failure (rate limit, no intraday data, etc.)
      // must never degrade a row that has valid daily bar data.
      // A 15-second timeout prevents a hanging socket from blocking a worker slot.
      let minuteBars: BarInput[] = []
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('intraday fetch timeout (15 s)')), 15_000)
        )
        minuteBars = await Promise.race([this.getIntradayBars(ticker.ticker), timeoutPromise])
      } catch (err) {
        if (err instanceof RateLimitError) rateLimited = true
        const errType = err instanceof Error ? err.constructor.name : 'UnknownError'
        appLog(`${ticker.ticker}: intraday fetch failed — ${String(err).slice(0, 80)}`, 'warn',
          `Symbol: ${ticker.ticker} | Error type: ${errType} | Layer: L1 (CandleCache) → L2 (SQLite) → L3 (Massive.com API) | Daily bars: ${dailyBars.length} available — TA will use daily-only MTF fallback`)
        /* non-critical — TA will use daily-only MTF fallback */
      }

      // Warm the real 5-minute series so the DB/cache has the latest candle
      // once each 5-minute period elapses. Non-blocking — never slows enrichment.
      void this.getFiveMinuteBars(ticker.ticker).catch(() => { /* optional */ })

      // Store today's open first so we can use intraState.lastPrice (live WS price)
      // as the most reliable current price when building todaySnap.
      let intraState = this.intraday.get(ticker.ticker)
      if (!intraState) {
        intraState = { '1': 'up', '5': 'up' }
        this.intraday.set(ticker.ticker, intraState)
      }
      if (ticker.day.o > 0) intraState.todayOpen = ticker.day.o

      // Build today's daily snapshot so D/W/M/Q/Y reflect the current session.
      // Use the most current price available (WS > lastTrade > min > day.c).
      // Historical daily bars only contain closed sessions, so without this D
      // would always show yesterday's direction.
      const currentPrice = intraState.lastPrice
        || ticker.lastTrade?.p
        || ticker.min?.c
        || ticker.day.c
        || 0
      const todaySnap = ticker.day.o > 0 && currentPrice > 0 ? {
        o: ticker.day.o,
        h: ticker.day.h || Math.max(ticker.day.o, currentPrice),
        l: ticker.day.l || Math.min(ticker.day.o, currentPrice),
        c: currentPrice,
        v: ticker.day.v,
      } : undefined

      const ta = computeTA(dailyBars, minuteBars.length > 0 ? minuteBars : undefined, todaySnap)
      this.avgVol30Cache.set(ticker.ticker, ta.avgVol30)

      // Safety net: if todaySnap was unavailable (ticker.day.o = 0), derive D direction
      // from the snapshot's todaysChangePerc which is always populated and represents
      // current price vs previous close (reliable proxy when we have no today open).
      if (!todaySnap) {
        ta.mtf.D = ticker.todaysChangePerc >= 0 ? 'up' : 'down'
      }

      // Use live WS price if available, else snapshot price (|| chain handles pre-market zeros)
      const last = intraState?.lastPrice || ticker.lastTrade?.p || ticker.day.c || ticker.prevDay.c
      if (!last) return null

      // Use accumulated volume for RVOL
      const todayVol = intraState?.accVolume ?? ticker.min?.av ?? ticker.day.v
      const rvol = computeRVOL(todayVol, ta.avgVol30)

      const row: ScannerRow = {
        id: ticker.ticker,
        symbol: ticker.ticker,
        last: Math.round(last * 100) / 100,
        chgDollar: Math.round(ticker.todaysChange * 100) / 100,
        chgPct: Math.round(ticker.todaysChangePerc * 100) / 100,
        sector: '',
        atrPct: ta.atrPct,
        atrDollar: ta.atrDollar,
        avgVol30: ta.avgVol30,
        rvol,
        inForce: ta.inForce,
        ftfc: ta.ftfc,
        mtf: ta.mtf,
        cc: ta.cc,
        cc1: ta.cc1,
        cc2: ta.cc2,
        pattern: ta.pattern,
        signal: ta.signal,
        category: ta.category,
        enrichLevel: rateLimited ? 'error' : minuteBars.length > 0 ? 'full' : 'daily',
        wsActive: this.isWsActive(ticker.ticker),
        day: {
          o: ticker.day.o,
          h: ticker.day.h || Math.max(ticker.day.o, currentPrice),
          l: ticker.day.l || Math.min(ticker.day.o, currentPrice),
          c: currentPrice,
        },
      }

      // Score Strat setup on intraday TFs (day trading only — no daily/swing setups)
      // Priority: 30M → 1H → 15M → 5M (first match wins)
      if (minuteBars.length > 0) {
        const sortedMin = [...minuteBars].sort((a, b) => a.timestamp - b.timestamp)
        const intradayTfs: Array<{ tf: '30' | '60' | '15' | '5'; aggregate: (b: typeof sortedMin) => typeof sortedMin }> = [
          { tf: '30', aggregate: aggregateTo30min },
          { tf: '60', aggregate: aggregateTo60min },
          { tf: '15', aggregate: aggregateTo15min },
          { tf: '5',  aggregate: aggregateTo5min  },
        ]
        for (const { tf, aggregate } of intradayTfs) {
          const tfBars = aggregate(sortedMin)
          if (tfBars.length < 3) continue
          const tfPattern = computePattern(computeCcCodes(tfBars))
          if (!tfPattern) continue
          const setup = scoreSetup(row, tfBars, tf, tfPattern)
          if (setup) {
            row.setup = setup
            this.maybeAlert(setup)
            break
          }
        }
      }

      return row
    } catch (err) {
      return this.buildMinimalRow(ticker, err instanceof RateLimitError ? 'error' : 'none')
    }
  }


  private buildMinimalRow(ticker: SnapshotTicker, enrichLevel: 'none' | 'error' = 'none'): ScannerRow | null {
    const last = ticker.lastTrade?.p || ticker.day.c || ticker.prevDay.c
    if (!last) return null
    return {
      id: ticker.ticker,
      symbol: ticker.ticker,
      last: Math.round(last * 100) / 100,
      chgDollar: Math.round(ticker.todaysChange * 100) / 100,
      chgPct: Math.round(ticker.todaysChangePerc * 100) / 100,
      sector: '',
      atrPct: 0,
      atrDollar: 0,
      avgVol30: 0,
      rvol: 0,
      inForce: false,
      ftfc: false,
      mtf: { '1': 'up', '5': 'up', D: 'up', W: 'up', M: 'up', Q: 'up', Y: 'up' },
      cc: '',
      cc1: '',
      cc2: '',
      pattern: '',
      signal: '',
      category: '',
      enrichLevel,
      wsActive: this.isWsActive(ticker.ticker),
      day: {
        o: ticker.day.o,
        h: ticker.day.h || Math.max(ticker.day.o, last),
        l: ticker.day.l || Math.min(ticker.day.o, last),
        c: last,
      },
    }
  }

  /** True when the live WS relay is connected AND streaming this symbol. */
  private isWsActive(symbol: string): boolean {
    const relay = getWsRelay()
    return relay.getStatus() === 'connected' && relay.isSubscribed(symbol)
  }

  private async getDailyBars(symbol: string): Promise<BarInput[]> {
    // L1: in-memory CandleCache — serve if fresh for the daily period (24 h) or
    // the market is closed (no new candle to fetch).
    const cached = getCandleCache().get(symbol, 'day')
    if (cached && (!isMarketSession(Date.now()) || isSeriesCurrent(cached, DAY_MS))) return cached

    // L2 → L3: SQLite DB (incremental) → Massive.com API (delta/full)
    const bars = await getOrSyncDailyBars(symbol)
    if (bars.length > 0) getCandleCache().set(symbol, 'day', bars)
    return bars
  }

  private async getIntradayBars(symbol: string): Promise<BarInput[]> {
    // L1: in-memory CandleCache — serve if fresh for the 1-minute period or the
    // market is closed. Otherwise refetch so each new minute creates its candle.
    const cached = getCandleCache().get(symbol, 'minute')
    if (cached && (!isMarketSession(Date.now()) || isSeriesCurrent(cached, MINUTE_MS))) return cached

    // L2 → L3: SQLite DB (rolling 5-day window) → Massive.com API (delta/full)
    const bars = await getOrSyncMinuteBars(symbol)
    if (bars.length > 0) getCandleCache().set(symbol, 'minute', bars)
    return bars
  }

  private async getFiveMinuteBars(symbol: string): Promise<BarInput[]> {
    // L1: in-memory CandleCache — serve if fresh for the 5-minute period or the
    // market is closed. Otherwise refetch so each new 5-min period creates its candle.
    const cached = getCandleCache().get(symbol, '5min')
    if (cached && (!isMarketSession(Date.now()) || isSeriesCurrent(cached, FIVE_MINUTE_MS))) return cached

    // L2 → L3: real 5-minute series fetched from the API and persisted
    const bars = await getOrSyncFiveMinuteBars(symbol)
    if (bars.length > 0) getCandleCache().set(symbol, '5min', bars)
    return bars
  }

  // ── Private: WS tick handling ─────────────────────────────────────────────

  private onTick(tick: AggregateTick): void {
    // Accept A (per-second aggregate), AM (per-minute aggregate), and T (trade)
    if (tick.ev !== 'A' && tick.ev !== 'AM' && tick.ev !== 'T') return
    const sym = tick.sym

    // Trade events use `p` for price; aggregate events use `c`
    const price = tick.c || tick.p || 0
    if (!price) return

    // Update live price/volume state
    let state = this.intraday.get(sym)
    if (!state) {
      state = { '1': 'up', '5': 'up' }
      this.intraday.set(sym, state)
    }
    state.lastPrice = price
    state.accVolume = tick.av

    // Build 10-second candles from the per-second aggregates (ephemeral).
    if (tick.ev === 'A') this.accumulateTenSecond(tick)

    if (tick.ev === 'AM') {
      // Completed 1-minute bar — persist to CandleCache and SQLite
      const bar: BarInput = {
        ticker: sym,
        timespan: 'minute',
        timestamp: tick.s,
        open: tick.o,
        high: tick.h,
        low: tick.l,
        close: tick.c,
        volume: tick.v,
      }
      getCandleCache().appendBar(sym, 'minute', bar)
      try { persistMinuteBar(bar) } catch { /* non-critical */ }

      // Update live intraday directions from REAL data only:
      //  '1' from the completed minute bar; '5' from the fetched 5m series.
      //  (No 15/30/60 — they are derived timeframes that are no longer shown.)
      const dir1 = bar.close >= bar.open ? 'up' : 'down'
      const fiveCache = getCandleCache().get(sym, '5min')
      state['1'] = dir1 as MtfSignal
      state['5'] = (fiveCache && fiveCache.length > 0 ? intradayDir(fiveCache) : dir1) as MtfSignal

      // Re-derive D/W/M/Q/Y on every completed minute bar so higher-TF chips
      // stay accurate throughout the session (e.g. a gap-up day flips W/M/Q/Y).
      // We use daily bars from the CandleCache + today's synthetic bar (todayOpen→lastClose).
      const minuteBars = getCandleCache().get(sym, 'minute') ?? [bar]
      const dailyCache = getCandleCache().get(sym, 'day')
      const lastMinBar = minuteBars[minuteBars.length - 1]!
      if (dailyCache && state.todayOpen && state.todayOpen > 0) {
        const snap: TodaySnap = { o: state.todayOpen, h: 0, l: 0, c: lastMinBar.close, v: 0 }
        const upperMtf = computeMtfState(dailyCache, undefined, snap)
        state['D'] = upperMtf.D
        state['W'] = upperMtf.W
        state['M'] = upperMtf.M
        state['Q'] = upperMtf.Q
        state['Y'] = upperMtf.Y
      } else {
        // Fallback: no daily cache or no todayOpen yet — derive D from prevDayClose only
        const livePrice = state.lastPrice || lastMinBar.close
        if (state.prevDayClose && state.prevDayClose > 0) {
          state['D'] = (livePrice >= state.prevDayClose ? 'up' : 'down') as MtfSignal
        }
      }
    }

    // Patch cached row if present
    const row = this.rowCache.get(sym)
    if (row) {
      row.last = Math.round(price * 100) / 100
      row.ts = tick.s || tick.e || Date.now()
      // Recompute change$ and change% from the stored previous-day close
      if (state.prevDayClose) {
        const diff = price - state.prevDayClose
        row.chgDollar = Math.round(diff * 100) / 100
        row.chgPct    = Math.round((diff / state.prevDayClose) * 10000) / 100
      }
      // RVOL updates on every tick as today's accumulated volume grows
      if (state.accVolume && row.avgVol30 > 0) {
        row.rvol = computeRVOL(state.accVolume, row.avgVol30)
      }
      // Keep today's session daily high/low/close live from the tick stream
      // (seeded from the snapshot; the open never changes mid-session).
      if (row.day) {
        row.day.h = Math.max(row.day.h, price)
        row.day.l = Math.min(row.day.l, price)
        row.day.c = price
      }
      if (tick.ev === 'AM') {
        row.mtf['1']  = state['1']
        row.mtf['5']  = state['5']
        if (state['D']) row.mtf['D'] = state['D']
        if (state['W']) row.mtf['W'] = state['W']
        if (state['M']) row.mtf['M'] = state['M']
        if (state['Q']) row.mtf['Q'] = state['Q']
        if (state['Y']) row.mtf['Y'] = state['Y']
        // FTFC must be recomputed after any MTF direction change
        row.ftfc = computeFTFC(row.mtf)
      }
      this.broadcastUpdate(row)
    }
  }

  /**
   * Accumulate a per-second `A` aggregate into the current 10-second bucket.
   * When the bucket rolls over, the completed bucket is stored in the CandleCache
   * '10s' buffer and broadcast to open charts (which drive the in-progress 10s
   * forming candle from the live price themselves).
   */
  private accumulateTenSecond(tick: AggregateTick): void {
    const sym = tick.sym
    if (!this.watchedSymbols.has(sym) || !tick.s) return
    const bucketStart = Math.floor(tick.s / 10_000) * 10_000
    const existing = this.tenSec.get(sym)
    if (!existing || existing.timestamp < bucketStart) {
      if (existing) this.finalizeTenSecond(sym, existing)
      this.tenSec.set(sym, {
        ticker: sym,
        timespan: '10s',
        timestamp: bucketStart,
        open: tick.o,
        high: tick.h,
        low: tick.l,
        close: tick.c,
        volume: tick.v,
      })
    } else if (existing.timestamp === bucketStart) {
      existing.high = Math.max(existing.high, tick.h)
      existing.low = Math.min(existing.low, tick.l)
      existing.close = tick.c
      existing.volume += tick.v
    }
  }

  private finalizeTenSecond(sym: string, bar: BarInput): void {
    const cache = getCandleCache().get(sym, '10s') ?? []
    const last = cache[cache.length - 1]
    // The REST-seeded history may already include this bucket — replace it.
    if (last && last.timestamp === bar.timestamp) cache[cache.length - 1] = bar
    else cache.push(bar)
    if (cache.length > TEN_SEC_BUFFER) cache.shift()
    getCandleCache().set(sym, '10s', cache)
    try { persistTenSecondBar(bar) } catch { /* non-critical */ }
    // Keep the watermark in sync so the background seed refresh never re-broadcasts
    // a live bucket that was already pushed.
    this.lastSentBar.set(`${sym}:10s`, bar.timestamp)
    this.broadcastBars(sym, '10s', [bar])
  }

  private broadcastUpdate(row: ScannerRow): void {
    const payload = { type: 'update', row }
    for (const writer of this.sseClients.values()) {
      try { writer(payload) } catch { /* ignore disconnected clients */ }
    }
  }

  private broadcastRowRemoved(symbol: string): void {
    const payload = { type: 'rowRemoved', symbol }
    for (const writer of this.sseClients.values()) {
      try { writer(payload) } catch { /* ignore disconnected clients */ }
    }
  }

  private broadcastStatus(status: string): void {
    const payload = { type: 'wsStatus', status }
    for (const writer of this.sseClients.values()) {
      try { writer(payload) } catch { /* ignore disconnected clients */ }
    }
  }

  private broadcastSetupAlert(setup: StratSetup): void {
    const payload = { type: 'setupAlert', setup }
    for (const writer of this.sseClients.values()) {
      try { writer(payload) } catch { /* ignore disconnected clients */ }
    }
  }

  private maybeAlert(setup: StratSetup): void {
    // Disabled for now — see `alertsEnabled` above.
    if (!this.alertsEnabled) return
    // Only alert on high-quality setups
    if (setup.quality !== 'A+' && setup.quality !== 'A') return
    const key = `${setup.symbol}-${setup.signalTf}-${setup.combo}`
    if (this.alertsSent.has(key)) return
    this.alertsSent.add(key)
    setup.alertSent = true
    this.broadcastSetupAlert(setup)
  }

  // ── Private: WS subscription management ──────────────────────────────────

  private updateWsSubscriptions(): void {
    // Subscribe the A stream to exactly the visible grid rows plus any open
    // chart symbols. The relay diffs against the current set, so symbols that
    // fell out of the visible window are unsubscribed automatically.
    const desired = [...new Set([...this.lastVisibleTickers, ...this.watchedSymbols])]
    getWsRelay().updateSubscriptions(desired)
  }
}

// ── Intraday direction helper ─────────────────────────────────────────────────
// Returns the direction of the last bar in an aggregated series.

/** True when the latest bar in a series is within `periodMs` of now — i.e. the
 *  series includes the current in-progress candle for that timeframe. */
function isSeriesCurrent(bars: BarInput[], periodMs: number): boolean {
  const last = bars[bars.length - 1]
  if (!last) return false
  return Date.now() - last.timestamp < periodMs
}

function intradayDir(bars: BarInput[]): MtfSignal {
  if (bars.length === 0) return 'up'
  const last = bars[bars.length - 1]!
  return last.close >= last.open ? 'up' : 'down'
}

// ── Criteria filter ────────────────────────────────────────────────────────────

function filterSnapshot(
  tickers: SnapshotTicker[],
  criteria: ScanCriteria,
  avgVol30Cache: Map<string, number>,
): SnapshotTicker[] {
  return tickers.filter(t => {
    // Pre-market: day.c is 0 (no regular-session close yet).  Fall through to
    // prevDay.c so the snapshot is still usable before the open.
    const price = t.lastTrade?.p || t.day.c || t.prevDay.c
    const chg   = t.todaysChangePerc
    const vol   = t.min?.av ?? t.day.v

    if (price === 0) return false

    if (criteria.minPrice !== undefined && criteria.minPrice !== null && price < criteria.minPrice) return false
    if (criteria.maxPrice !== undefined && criteria.maxPrice !== null && price > criteria.maxPrice) return false
    if (criteria.minChangePercent !== undefined && criteria.minChangePercent !== null && chg < criteria.minChangePercent) return false
    if (criteria.maxChangePercent !== undefined && criteria.maxChangePercent !== null && chg > criteria.maxChangePercent) return false
    if (criteria.minVolume !== undefined && criteria.minVolume !== null && vol < criteria.minVolume) return false
    // Best-effort rvol pre-filter using a cached avgVol30 from a previous
    // enrichment. Symbols we've never enriched are left for the authoritative
    // post-enrichment filter, so we never drop a valid candidate prematurely.
    if (criteria.minRvol !== undefined && criteria.minRvol !== null) {
      const avg = avgVol30Cache.get(t.ticker)
      if (avg && avg > 0) {
        const rvol = computeRVOL(vol, avg)
        if (rvol < criteria.minRvol) return false
      }
    }

    return true
  })
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global { var __scannerEngine: ScannerEngine | undefined }

export function getScannerEngine(): ScannerEngine {
  if (!globalThis.__scannerEngine) globalThis.__scannerEngine = new ScannerEngine()
  return globalThis.__scannerEngine
}
