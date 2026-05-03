import { ref, computed } from 'vue'
import type { ScannerRow, ScannerTimeframe, ScannerMode, SortDirection, QuickFilter } from '~/types/scanner'
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

const PAGE_SIZE = 50

// ── Persisted state ───────────────────────────────────────────────────────────

const SCANNER_STATE_KEY = 'pulse-scanner-state'

interface PersistedState {
  timeframe: ScannerTimeframe
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

const timeframe          = ref<ScannerTimeframe>('D')
const mode               = ref<ScannerMode>('signal')
const activeQuickFilter  = ref<string | null>(null)
const sortKey            = ref<keyof ScannerRow | null>(null)
const sortDir            = ref<SortDirection>(null)

const rows               = ref<ScannerRow[]>([])
const isScanning         = ref(false)
const scanError          = ref<string | null>(null)
const total              = ref(0)
const universeCount      = ref(0)
const lastScan           = ref<string>('')
const nextCursor         = ref<string | null>(null)
const isLoadingMore      = ref(false)
const wsStatus           = ref<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')

let eventSource: EventSource | null = null
let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null

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
  saveState({ timeframe: timeframe.value, mode: mode.value, activeQuickFilter: activeQuickFilter.value, sortKey: sortKey.value, sortDir: sortDir.value })
}

function initScanner() {
  const ps = loadState()
  timeframe.value         = ps.timeframe         ?? 'D'
  mode.value              = ps.mode              ?? 'signal'
  activeQuickFilter.value = ps.activeQuickFilter ?? null
  sortKey.value           = ps.sortKey           ?? null
  sortDir.value           = ps.sortDir           ?? null
}

function setTimeframe(tf: ScannerTimeframe) { timeframe.value = tf; persist() }
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
    else sortDir.value = 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
  persist()
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function runScan(append = false) {
  if (isScanning.value) return
  isScanning.value = true
  scanError.value  = null

  const { criteria, criteriaToParams } = useScanCriteria()
  const params = new URLSearchParams({ ...criteriaToParams(criteria.value), limit: String(PAGE_SIZE) })

  try {
    const data = await $fetch<{ success: boolean; rows: ScannerRow[]; total: number; universeCount: number; lastScan: string; nextCursor: string | null }>(
      `/api/scanner/scan?${params.toString()}`
    )
    rows.value         = append ? [...rows.value, ...data.rows] : data.rows
    total.value        = data.total
    universeCount.value = data.universeCount
    lastScan.value     = data.lastScan
    nextCursor.value   = data.nextCursor
  } catch (err) {
    scanError.value = err instanceof Error ? err.message : 'Scan failed'
  } finally {
    isScanning.value = false
  }
}

async function loadMore() {
  if (isLoadingMore.value || !nextCursor.value) return
  isLoadingMore.value = true
  const { criteria, criteriaToParams } = useScanCriteria()
  const params = new URLSearchParams({ ...criteriaToParams(criteria.value), limit: String(PAGE_SIZE), cursor: nextCursor.value })
  try {
    const data = await $fetch<{ success: boolean; rows: ScannerRow[]; total: number; nextCursor: string | null }>(`/api/scanner/scan?${params.toString()}`)
    rows.value       = [...rows.value, ...data.rows]
    nextCursor.value = data.nextCursor
    total.value      = data.total
  } catch (err) {
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
  if (eventSource) return
  wsStatus.value = 'connecting'
  eventSource = new EventSource('/api/scanner/subscribe')
  eventSource.onopen = () => { wsStatus.value = 'connected' }
  eventSource.onmessage = (e: MessageEvent) => {
    try {
      const msg = JSON.parse(e.data as string) as { type: 'snapshot'; rows: ScannerRow[] } | { type: 'update'; row: ScannerRow }
      if (msg.type === 'snapshot') {
        if (rows.value.length === 0) rows.value = msg.rows
      } else if (msg.type === 'update') {
        const idx = rows.value.findIndex(r => r.symbol === msg.row.symbol)
        if (idx >= 0) rows.value[idx] = { ...rows.value[idx]!, ...msg.row }
      }
    } catch { /* ignore */ }
  }
  eventSource.onerror = () => { wsStatus.value = 'error' }
}

function disconnectLive() {
  eventSource?.close()
  eventSource = null
  wsStatus.value = 'disconnected'
}

// ── Export ────────────────────────────────────────────────────────────────────

export function useScanner() {
  return {
    timeframe, mode, activeQuickFilter, sortKey, sortDir,
    rows, isScanning, scanError, total, universeCount, lastScan,
    nextCursor, isLoadingMore, wsStatus,
    filteredRows, totalCount, showingCount,
    allRows: rows,
    initScanner, setTimeframe, setMode, toggleQuickFilter, clearFilters, setSortBy,
    runScan, loadMore, scheduleScan, connectLive, disconnectLive,
    QUICK_FILTERS,
  }
}
