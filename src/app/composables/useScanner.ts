import { ref, computed } from 'vue'
import type { ScannerRow, ScannerMode, SortDirection, QuickFilter, StratSetup } from '~/types/scanner'
import { useScanCriteria } from '~/composables/useScanCriteria'

// ── Constants ────────────────────────────────────────────────────────────────

export const QUICK_FILTERS: QuickFilter[] = [
  { id: 'reversals',    label: 'Reversals' },
  { id: 'hammers',      label: 'Hammers' },
  { id: 'shooters',     label: 'Shooters' },
  { id: 'inside-bars',  label: 'Inside Bars' },
  { id: '2-2-up',       label: '2-2 Up Cont.' },
  { id: '2-2-down',     label: '2-2 Down Cont.' },
  { id: '2-down-green', label: '2 Down in Green' },
  { id: '2-up-red',     label: '2 Up in Red' },
  { id: 'in-force',     label: 'In Force' },
]

// Visible grid window: starts at 50, grows by 10 on "Load more".
const INITIAL_VISIBLE = 50
const VISIBLE_STEP    = 10

// ── Persisted state ───────────────────────────────────────────────────────────

const SCANNER_STATE_KEY = 'pulse-scanner-state'

interface PersistedState {
  mode: ScannerMode
  activeQuickFilter: string | null
  sortKey: keyof ScannerRow | null
  sortDir: SortDirection
}

function loadState(): Partial<PersistedState> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SCANNER_STATE_KEY)
    return raw ? (JSON.parse(raw) as PersistedState) : {}
  } catch { return {} }
}

function saveState(s: PersistedState) {
  if (typeof window === 'undefined') return
  localStorage.setItem(SCANNER_STATE_KEY, JSON.stringify(s))
}

// ── Module-level singleton state ──────────────────────────────────────────────

const mode               = ref<ScannerMode>('signal')
const activeQuickFilter  = ref<string | null>(null)
const sortKey            = ref<keyof ScannerRow | null>('chgPct')
const sortDir            = ref<SortDirection>('desc')

const rows               = ref<ScannerRow[]>([])
const isScanning         = ref(false)
const scanError          = ref<string | null>(null)
const total              = ref(0)
const universeCount      = ref(0)
const lastScan           = ref<string>('')
const nextCursor         = ref<string | null>(null)
const isLoadingMore      = ref(false)
// How many top matches are currently visible in the grid (grows via Load more).
const visible            = ref(INITIAL_VISIBLE)
// Seconds until the next auto-rescan (fires on the next minute boundary).
const secondsToNextScan  = ref(0)
const wsStatus           = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')
// Tracks the *server-side* WS relay status (pushed via SSE messages).
// Separate from wsStatus which only reflects the EventSource connection.
const serverWsStatus     = ref<'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error'>('disconnected')
// Latest setup alerts pushed by the server for A+/A setups.
const latestSetupAlert   = ref<StratSetup | null>(null)

let eventSource: EventSource | null = null
let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null
let rescanTimer: ReturnType<typeof setInterval> | null = null

// ── Bar-event pub/sub (charts subscribe; data layer pushes new candles) ──────

export interface BarsEvent {
  type: 'bars'
  symbol: string
  timespan: string
  bars: { t: number; o: number; h: number; l: number; c: number; v: number }[]
}
type BarsHandler = (msg: BarsEvent) => void
const barsHandlers = new Set<BarsHandler>()

/** Subscribe to new-candle events pushed by the data layer. Returns unsubscribe. */
export function subscribeBars(h: BarsHandler): () => void {
  barsHandlers.add(h)
  return () => { barsHandlers.delete(h) }
}

// ── Computed ──────────────────────────────────────────────────────────────────

const filteredRows = computed<ScannerRow[]>(() => {
  let r = [...rows.value]

  if (activeQuickFilter.value) {
    const f = activeQuickFilter.value
    if (f === 'inside-bars')       r = r.filter(x => x.category === 'Inside')
    else if (f === 'hammers')      r = r.filter(x => x.signal.toLowerCase().includes('hammer'))
    else if (f === 'shooters')     r = r.filter(x => x.signal.toLowerCase().includes('shooter'))
    else if (f === 'reversals')    r = r.filter(x => x.category === 'Reversal')
    else if (f === '2-2-up')       r = r.filter(x => x.signal.includes('2-2 Up'))
    else if (f === '2-2-down')     r = r.filter(x => x.signal.includes('2-2 Down') || x.signal.includes('Down Cont'))
    else if (f === '2-down-green') r = r.filter(x => x.signal.includes('Green'))
    else if (f === '2-up-red')     r = r.filter(x => x.signal.includes('Red'))
    else if (f === 'in-force')     r = r.filter(x => x.inForce)
  }

  if (sortKey.value && sortDir.value) {
    const key = sortKey.value
    const dir = sortDir.value
    r.sort((a, b) => {
      const av = a[key] as number | string | boolean
      const bv = b[key] as number | string | boolean
      if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av
      return dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
  }

  return r
})

const totalCount    = computed(() => total.value)
const showingCount  = computed(() => filteredRows.value.length)

// ── Actions ───────────────────────────────────────────────────────────────────

function persist() {
  saveState({ mode: mode.value, activeQuickFilter: activeQuickFilter.value, sortKey: sortKey.value, sortDir: sortDir.value })
}

function initScanner() {
  const ps = loadState()
  mode.value              = ps.mode              ?? 'signal'
  activeQuickFilter.value = ps.activeQuickFilter ?? null
  sortKey.value           = ps.sortKey           ?? 'chgPct'
  sortDir.value           = ps.sortDir           ?? 'desc'
}

function setMode(m: ScannerMode)             { mode.value = m; persist() }

function toggleQuickFilter(id: string) {
  activeQuickFilter.value = activeQuickFilter.value === id ? null : id
  persist()
}

function clearFilters() { activeQuickFilter.value = null; persist() }

function setSortBy(key: keyof ScannerRow) {
  if (sortKey.value === key) {
    if (sortDir.value === 'asc') sortDir.value = 'desc'
    else if (sortDir.value === 'desc') { sortDir.value = null; sortKey.value = null }
    else { sortKey.value = 'chgPct'; sortDir.value = 'desc' }  // reset to default
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
  persist()
}

// Column-filter clear callback — set by useGridFilters so runScan can clear
// stale column filters whenever fresh scan rows are loaded.
let onScanRowsLoaded: (() => void) | null = null
export function registerScanRowsLoadedCallback(cb: () => void) { onScanRowsLoaded = cb }

// ── API calls ─────────────────────────────────────────────────────────────────

// Shared in-flight lock so manual scans and silent background rescans never
// overlap.
let scanLock = false

/**
 * Run a scan.
 * @param silent  when true, no loading spinner is shown — used by the periodic
 *                minute rescan so the grid updates seamlessly (rows update /
 *                appear / disappear without an overlay).
 */
async function runScan(append = false, silent = false) {
  if (scanLock) return
  scanLock = true
  if (!silent) {
    isScanning.value = true
    scanError.value  = null
  }

  try {
    const { criteria, criteriaToParams } = useScanCriteria()
    const params = new URLSearchParams({ ...criteriaToParams(criteria.value), visible: String(visible.value) })

    const data = await $fetch<{ success: boolean; rows: ScannerRow[]; total: number; universeCount: number; lastScan: string; nextCursor: string | null }>(
      `/api/scanner/scan?${params.toString()}`,
      { timeout: 45_000 }
    )
    rows.value          = data.rows
    total.value         = data.total
    universeCount.value = data.universeCount
    lastScan.value      = data.lastScan
    nextCursor.value    = data.nextCursor
    // Clear stale column filters so rows from the new scan are not silently
    // filtered out by values that no longer exist in the result set.
    if (!append) onScanRowsLoaded?.()
  } catch (err) {
    if (!silent) scanError.value = err instanceof Error ? err.message : 'Scan failed'
  } finally {
    scanLock = false
    isScanning.value = false
    // Reset the countdown to the next minute boundary so the next auto-rescan
    // fires exactly on the new minute.
    secondsToNextScan.value = 60 - (Math.floor(Date.now() / 1000) % 60)
  }
}

async function loadMore() {
  if (isLoadingMore.value || !nextCursor.value) return
  isLoadingMore.value = true
  visible.value += VISIBLE_STEP
  const { criteria, criteriaToParams } = useScanCriteria()
  const params = new URLSearchParams({ ...criteriaToParams(criteria.value), visible: String(visible.value) })
  try {
    const data = await $fetch<{ success: boolean; rows: ScannerRow[]; total: number; nextCursor: string | null }>(
      `/api/scanner/scan?${params.toString()}`,
      { timeout: 45_000 }
    )
    rows.value       = data.rows
    nextCursor.value = data.nextCursor
    total.value      = data.total
  } catch (err) {
    visible.value -= VISIBLE_STEP
    scanError.value = err instanceof Error ? err.message : 'Load more failed'
  } finally {
    isLoadingMore.value = false
  }
}

function scheduleScan() {
  if (scanDebounceTimer) clearTimeout(scanDebounceTimer)
  scanDebounceTimer = setTimeout(() => runScan(false), 300)
}

// ── SSE live updates ──────────────────────────────────────────────────────────

function connectLive() {
  // SSE is the app's own push channel: it carries the rowCache snapshot, the
  // progressive phase-2 scan rows and the server WS status. It does NOT carry
  // upstream market data (that is gated server-side by liveFeedEnabled).
  if (eventSource) return
  wsStatus.value = 'connecting'
  eventSource = new EventSource('/api/scanner/subscribe')

  eventSource.onopen = () => { wsStatus.value = 'connected' }

  eventSource.onmessage = (e: MessageEvent) => {
    try {
      const msg = JSON.parse(e.data as string) as
        | { type: 'snapshot'; rows: ScannerRow[] }
        | { type: 'update'; row: ScannerRow }
        | { type: 'rowRemoved'; symbol: string }
        | { type: 'wsStatus'; status: string }
        | { type: 'setupAlert'; setup: StratSetup }
        | BarsEvent

      if (msg.type === 'snapshot') {
        // Always adopt a non-empty snapshot from the server so reconnects
        // pick up the latest cache.  Ignore empty snapshots (server restarted
        // with cold cache — the onopen rescan will repopulate shortly).
        if (msg.rows.length > 0) rows.value = msg.rows
      } else if (msg.type === 'update') {
        const idx = rows.value.findIndex(r => r.symbol === msg.row.symbol)
        if (idx >= 0) {
          rows.value.splice(idx, 1, { ...rows.value[idx]!, ...msg.row })
        } else {
          // Upsert: progressive phase-2 rows arrive via SSE and may not yet be
          // in the page returned by the scan response.
          rows.value.push(msg.row)
        }
      } else if (msg.type === 'rowRemoved') {
        rows.value = rows.value.filter(r => r.symbol !== msg.symbol)
      } else if (msg.type === 'wsStatus') {
        serverWsStatus.value = msg.status as typeof serverWsStatus.value
      } else if (msg.type === 'setupAlert') {
        latestSetupAlert.value = msg.setup
      } else if (msg.type === 'bars') {
        // New candles from the data layer — fan out to chart subscribers.
        for (const h of barsHandlers) h(msg)
      }
    } catch { /* ignore malformed frames */ }
  }

  eventSource.onerror = () => { wsStatus.value = 'error' }
}

function disconnectLive() {
  eventSource?.close()
  eventSource = null
  wsStatus.value = 'disconnected'
}

// ── Auto-rescan (fires on the new minute) ─────────────────────────────────────
// Ticks the countdown down each second. At 0 (the next minute boundary) it
// re-runs the scan — but only after an initial scan has been performed, so the
// app still boots with zero data activity.

function startAutoRefresh() {
  if (rescanTimer) return
  rescanTimer = setInterval(() => {
    if (!lastScan.value) { secondsToNextScan.value = 0; return }
    if (scanLock) return
    secondsToNextScan.value -= 1
    if (secondsToNextScan.value <= 0) {
      // Silent: no loading spinner — the grid updates seamlessly on the new minute.
      void runScan(false, true)
    }
  }, 1000)
}

function stopAutoRefresh() {
  if (rescanTimer) { clearInterval(rescanTimer); rescanTimer = null }
  secondsToNextScan.value = 0
}

// ── Export ────────────────────────────────────────────────────────────────────

export function useScanner() {
  return {
    mode, activeQuickFilter, sortKey, sortDir,
    rows, isScanning, scanError, total, universeCount, lastScan,
    nextCursor, isLoadingMore, visible, secondsToNextScan,
    wsStatus, serverWsStatus, latestSetupAlert,
    filteredRows, totalCount, showingCount,
    allRows: rows,
    initScanner, setMode, toggleQuickFilter, clearFilters, setSortBy,
    runScan, loadMore, scheduleScan, connectLive, disconnectLive,
    startAutoRefresh, stopAutoRefresh,
    subscribeBars,
    QUICK_FILTERS,
  }
}
