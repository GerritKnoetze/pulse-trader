/**
 * Scanner Engine — orchestrates the full scan pipeline:
 *
 * 1. Fetch full-market snapshot (cached 60 s)
 * 2. Apply ScanCriteria (price, change%, volume) → filtered candidate set
 * 3. Sort candidates by |changePercent| DESC
 * 4. For the requested page: fetch/get-cached bars per ticker (L1→L2→L3)
 *    - Daily bars: permanent in SQLite, incremental delta from API
 *    - 1-min bars: rolling 5-trading-day window in SQLite, incremental delta
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
import { computeTA, computeRVOL, computeCcCodes, computePattern, aggregateTo5min, aggregateTo15min, aggregateTo30min, aggregateTo60min } from './ta-calculator'
import { getWsRelay } from './ws-relay'
import { getOrSyncDailyBars, getOrSyncMinuteBars, persistMinuteBar } from './market-data.service'
import { appLog } from './app-log'

// ── Config ────────────────────────────────────────────────────────────────────

const TIER1_SIZE      = 50   // full A+Q subscriptions
const TIER2_SIZE      = 150  // A-only subscriptions
const MAX_CONCURRENCY = 10   // parallel bar fetches per scan page

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
  '15': MtfSignal
  '30': MtfSignal
  '60': MtfSignal
  // live price/volume data
  lastPrice?: number
  accVolume?: number
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

  // Intraday data from WS (updated every tick)
  private intraday = new Map<string, IntradayState>()

  // Last scan metadata
  private lastScanAt: string = ''
  private lastCriteria: ScanCriteria | null = null
  private lastSortedCandidates: SnapshotTicker[] = []

  constructor() {
    // Wire WS tick handler
    getWsRelay().onTick('scanner-engine', (tick) => this.onTick(tick as AggregateTick))

    // Log WS status changes and fan-out to SSE clients so the browser status
    // indicator accurately reflects the server-side WS relay state.
    let disconnectLogTimer: ReturnType<typeof setTimeout> | null = null
    getWsRelay().onStatus('scanner-engine-log', (status) => {
      if (disconnectLogTimer) { clearTimeout(disconnectLogTimer); disconnectLogTimer = null }
      if (status === 'connected') {
        appLog('WS connected — live ticks active')
        this.broadcastStatus(status)
      } else if (status === 'error') {
        appLog('WS error — check API key / network', 'error')
        this.broadcastStatus(status)
      } else if (status === 'disconnected') {
        disconnectLogTimer = setTimeout(() => {
          disconnectLogTimer = null
          appLog('WS disconnected', 'warn')
          this.broadcastStatus('disconnected')
        }, 3_000)
      }
      // 'connecting' and 'authenticating' intentionally not logged / broadcast
    })

  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Run a full scan with the given criteria and return a page of results.
   * @param criteria  filter parameters
   * @param cursor    symbol to start after (for pagination), or null for first page
   * @param limit     max rows to return per page
   */
  async scan(criteria: ScanCriteria, cursor: string | null, limit: number): Promise<ScanPage> {
    const isFirstPage = !cursor
    if (isFirstPage) {
      const parts: string[] = []
      if (criteria.minPrice != null || criteria.maxPrice != null)
        parts.push(`price ${criteria.minPrice ?? ''}–${criteria.maxPrice ?? ''}`)
      if (criteria.minChangePercent != null || criteria.maxChangePercent != null)
        parts.push(`chg% ${criteria.minChangePercent ?? ''}–${criteria.maxChangePercent ?? ''}`)
      if (criteria.minVolume != null) parts.push(`vol ≥${criteria.minVolume.toLocaleString()}`)
      appLog(`Scan started${parts.length ? ' — ' + parts.join(', ') : ''}`)
    }

    const snapshot = await getSnapshotCache().getSnapshot()
    // Deduplicate by ticker (API can return the same symbol from multiple exchanges)
    const seen = new Set<string>()
    const unique = snapshot.filter(t => { if (seen.has(t.ticker)) return false; seen.add(t.ticker); return true })
    const candidates = filterSnapshot(unique, criteria)

    if (isFirstPage) {
      appLog(`Snapshot: ${snapshot.length.toLocaleString()} universe → ${candidates.length.toLocaleString()} matched`)
    }

    // Sort by |change%| descending so biggest movers are first
    candidates.sort((a, b) => Math.abs(b.todaysChangePerc) - Math.abs(a.todaysChangePerc))

    this.lastSortedCandidates = candidates
    this.lastCriteria = criteria

    // Pre-populate prevDayClose for all tier1+tier2 symbols so onTick can
    // compute live chgDollar / chgPct without snapshot data at tick time.
    for (const t of candidates.slice(0, TIER1_SIZE + TIER2_SIZE)) {
      let state = this.intraday.get(t.ticker)
      if (!state) {
        state = { '1': 'up', '5': 'up', '15': 'up', '30': 'up', '60': 'up' }
        this.intraday.set(t.ticker, state)
      }
      if (t.prevDay.c) state.prevDayClose = t.prevDay.c
    }

    // Pagination: find cursor position
    let startIdx = 0
    if (cursor) {
      const idx = candidates.findIndex(c => c.ticker === cursor)
      if (idx >= 0) startIdx = idx + 1
    }

    const page = candidates.slice(startIdx, startIdx + limit)
    appLog(`Enriching ${page.length} symbol${page.length !== 1 ? 's' : ''} (page offset ${startIdx})`)
    const enriched = await this.enrichPage(page)
    appLog(`Enriched ${enriched.length}/${page.length} symbols — TA computed`)

    // Apply minRvol filter post-enrichment (requires computed avgVol30 from bar data)
    const rows = criteria.minRvol != null
      ? enriched.filter(r => r.rvol >= criteria.minRvol!)
      : enriched

    // Update row cache
    for (const row of rows) this.rowCache.set(row.symbol, row)

    // Update WS subscriptions based on full sorted list
    this.updateWsSubscriptions(candidates.slice(0, TIER1_SIZE + TIER2_SIZE))

    this.lastScanAt = new Date().toISOString()
    if (isFirstPage) {
      const tickers = rows.slice(0, 5).map(r => r.symbol).join(', ')
      appLog(`Scan complete — ${rows.length} rows${rows.length > 0 ? ` (top: ${tickers}${rows.length > 5 ? '…' : ''})` : ''}`)
    }

    return {
      rows,
      total: candidates.length,
      nextCursor: startIdx + limit < candidates.length
        ? candidates[startIdx + limit - 1]!.ticker
        : null,
      universeCount: snapshot.length,
      lastScan: this.lastScanAt,
    }
  }

  getCachedRows(): ScannerRow[] { return [...this.rowCache.values()] }

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
    }
  }

  addSseClient(id: string, writer: SseWriter): void { this.sseClients.set(id, writer) }
  removeSseClient(id: string): void { this.sseClients.delete(id) }

  // ── Private: enrichment ──────────────────────────────────────────────────

  private async enrichPage(candidates: SnapshotTicker[]): Promise<ScannerRow[]> {
    // Work-stealing pool: always keep MAX_CONCURRENCY enrichments in-flight.
    // Unlike serial batching (wait for all 10 before starting the next 10),
    // each worker immediately picks the next symbol as soon as it finishes.
    // This eliminates the "wait for the slowest L3 fetch in a batch" stall.
    const results: (ScannerRow | null)[] = new Array(candidates.length).fill(null)
    let nextIdx = 0
    const worker = async () => {
      while (nextIdx < candidates.length) {
        const i = nextIdx++
        results[i] = await this.enrichTicker(candidates[i]!)
      }
    }
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENCY, candidates.length) },
      worker,
    )
    await Promise.all(workers)
    return results.filter((r): r is ScannerRow => r !== null)
  }

  private async enrichTicker(ticker: SnapshotTicker): Promise<ScannerRow | null> {
    try {
      const dailyBars = await this.getDailyBars(ticker.ticker)
      if (dailyBars.length < 2) {
        appLog(`${ticker.ticker}: insufficient daily bars (${dailyBars.length}) — skipped`, 'warn')
        return null
      }

      // Minute bars are optional — a failure (rate limit, no intraday data, etc.)
      // must never degrade a row that has valid daily bar data.
      let minuteBars: BarInput[] = []
      try {
        minuteBars = await this.getIntradayBars(ticker.ticker)
      } catch (err) {
        appLog(`${ticker.ticker}: intraday fetch failed — ${String(err).slice(0, 80)}`, 'warn')
        /* non-critical — TA will use daily-only MTF fallback */
      }

      const ta = computeTA(dailyBars, minuteBars.length > 0 ? minuteBars : undefined)

      // Use live WS price if available, else snapshot price (|| chain handles pre-market zeros)
      const intraState = this.intraday.get(ticker.ticker)
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
    } catch {
      return this.buildMinimalRow(ticker)
    }
  }


  private buildMinimalRow(ticker: SnapshotTicker): ScannerRow | null {
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
      mtf: { '1': 'up', '5': 'up', '15': 'up', '30': 'up', '60': 'up', D: 'up', W: 'up', M: 'up', Q: 'up', Y: 'up' },
      cc: '',
      cc1: '',
      cc2: '',
      pattern: '',
      signal: '',
      category: '',
    }
  }

  private async getDailyBars(symbol: string): Promise<BarInput[]> {
    // L1: in-memory CandleCache
    const cached = getCandleCache().get(symbol, 'day')
    if (cached) return cached

    // L2 → L3: SQLite DB (incremental) → Massive.com API (delta/full)
    const bars = await getOrSyncDailyBars(symbol)
    if (bars.length > 0) getCandleCache().set(symbol, 'day', bars)
    return bars
  }

  private async getIntradayBars(symbol: string): Promise<BarInput[]> {
    // L1: in-memory CandleCache
    const cached = getCandleCache().get(symbol, 'minute')
    if (cached) return cached

    // L2 → L3: SQLite DB (rolling 5-day window) → Massive.com API (delta/full)
    const bars = await getOrSyncMinuteBars(symbol)
    if (bars.length > 0) getCandleCache().set(symbol, 'minute', bars)
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
      state = { '1': 'up', '5': 'up', '15': 'up', '30': 'up', '60': 'up' }
      this.intraday.set(sym, state)
    }
    state.lastPrice = price
    state.accVolume = tick.av

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

      // Re-derive all intraday directions from the updated 1-min bar set in CandleCache.
      const minuteBars = getCandleCache().get(sym, 'minute') ?? [bar]
      const dir1  = bar.close >= bar.open ? 'up' : 'down'
      const dir5  = intradayDir(aggregateTo5min(minuteBars))
      const dir15 = intradayDir(aggregateTo15min(minuteBars))
      const dir30 = intradayDir(aggregateTo30min(minuteBars))
      const dir60 = intradayDir(aggregateTo60min(minuteBars))
      state['1']  = dir1 as MtfSignal
      state['5']  = dir5 as MtfSignal
      state['15'] = dir15 as MtfSignal
      state['30'] = dir30 as MtfSignal
      state['60'] = dir60 as MtfSignal
    }

    // Patch cached row if present
    const row = this.rowCache.get(sym)
    if (row) {
      row.last = Math.round(price * 100) / 100
      // Recompute change$ and change% from the stored previous-day close
      if (state.prevDayClose) {
        const diff = price - state.prevDayClose
        row.chgDollar = Math.round(diff * 100) / 100
        row.chgPct    = Math.round((diff / state.prevDayClose) * 10000) / 100
      }
      if (tick.ev === 'AM') {
        row.mtf['1']  = state['1']
        row.mtf['5']  = state['5']
        row.mtf['15'] = state['15']
        row.mtf['30'] = state['30']
        row.mtf['60'] = state['60']
      }
      this.broadcastUpdate(row)
    }
  }

  private broadcastUpdate(row: ScannerRow): void {
    const payload = { type: 'update', row }
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
    // Only alert on high-quality setups
    if (setup.quality !== 'A+' && setup.quality !== 'A') return
    const key = `${setup.symbol}-${setup.signalTf}-${setup.combo}`
    if (this.alertsSent.has(key)) return
    this.alertsSent.add(key)
    setup.alertSent = true
    this.broadcastSetupAlert(setup)
  }

  // ── Private: WS subscription management ──────────────────────────────────

  private updateWsSubscriptions(top: SnapshotTicker[]): void {
    const tier1 = top.slice(0, TIER1_SIZE).map(t => t.ticker)
    const tier2 = top.slice(TIER1_SIZE, TIER1_SIZE + TIER2_SIZE).map(t => t.ticker)
    getWsRelay().updateSubscriptions(tier1, tier2)
  }
}

// ── Intraday direction helper ─────────────────────────────────────────────────
// Returns the direction of the last bar in an aggregated series.

function intradayDir(bars: BarInput[]): MtfSignal {
  if (bars.length === 0) return 'up'
  const last = bars[bars.length - 1]!
  return last.close >= last.open ? 'up' : 'down'
}

// ── Criteria filter ────────────────────────────────────────────────────────────

function filterSnapshot(tickers: SnapshotTicker[], criteria: ScanCriteria): SnapshotTicker[] {
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

    return true
  })
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global { var __scannerEngine: ScannerEngine | undefined }

export function getScannerEngine(): ScannerEngine {
  if (!globalThis.__scannerEngine) globalThis.__scannerEngine = new ScannerEngine()
  return globalThis.__scannerEngine
}
