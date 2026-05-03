import { ref, computed } from 'vue'
import type { ScannerRow, ScannerTimeframe, ScannerMode, SortDirection, QuickFilter } from '~/types/scanner'

// ── Mock data (from "The Strat" scanner reference) ─────────
const MOCK_ROWS: ScannerRow[] = [
  { id: '1',  symbol: 'COIN', atrPct:  5.4, last:   260.37, sector: 'Technology',         category: '',              signal: '3-2 Expansion +', pattern: '1-3-2u',   cc2: '1',  cc1: '3',  cc: '2u', avgVol30:   9660000, inForce: true,  ftfc: true,  chgDollar:  51.43, chgPct: 24.61, atrDollar:  14.06, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '2',  symbol: 'KLAC', atrPct:  3.8, last:   794.33, sector: 'Technology',         category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:   1410000, inForce: true,  ftfc: true,  chgDollar:  49.33, chgPct:  6.62, atrDollar:  30.18, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '3',  symbol: 'FSLR', atrPct:  5.6, last:   196.13, sector: 'Energy',             category: 'Inside',        signal: 'Inside Up',       pattern: '1-2u',     cc2: '3',  cc1: '1',  cc: '2u', avgVol30:   5010000, inForce: true,  ftfc: true,  chgDollar:  47.19, chgPct: 31.74, atrDollar:  10.98, mtf: { '15': 'down', '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'down', Y: 'down' } },
  { id: '4',  symbol: 'MPWR', atrPct:  4.9, last:   734.75, sector: 'Technology',         category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:   1100000, inForce: true,  ftfc: false, chgDollar:  40.77, chgPct:  5.87, atrDollar:  36.00, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '5',  symbol: 'PTIR', atrPct:  9.9, last:   277.79, sector: '',                   category: '',              signal: '3-2u Expansion',  pattern: '3-2u',     cc2: '',   cc1: '3',  cc: '2u', avgVol30:   1380000, inForce: false, ftfc: false, chgDollar:  35.39, chgPct: 14.61, atrDollar:  27.50, mtf: { '15': 'down', '30': 'down', '60': 'up',   D: 'up',   W: 'down', Q: 'down', Y: 'down' } },
  { id: '6',  symbol: 'CVNA', atrPct:  5.4, last:   307.99, sector: 'Consumer Cyclicals', category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:   4850000, inForce: true,  ftfc: true,  chgDollar:  29.48, chgPct: 10.58, atrDollar:  16.63, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '7',  symbol: 'REGN', atrPct:  4.6, last:   571.71, sector: 'Healthcare',         category: 'Continuation',  signal: '3-2-2 Up',        pattern: '3-2d-1',   cc2: '3',  cc1: '2d', cc: '1',  avgVol30:   1310000, inForce: false, ftfc: false, chgDollar:  27.89, chgPct:  5.13, atrDollar:  26.30, mtf: { '15': 'down', '30': 'down', '60': 'down', D: 'up',   W: 'up',   Q: 'down', Y: 'down' } },
  { id: '8',  symbol: 'NFLX', atrPct:  3.0, last:  1150.92, sector: 'Technology',         category: '',              signal: '2-2 Reversal',    pattern: '2u-2d',    cc2: '',   cc1: '2u', cc: '2d', avgVol30:   5340000, inForce: false, ftfc: true,  chgDollar:  26.66, chgPct:  2.37, atrDollar:  34.53, mtf: { '15': 'down', '30': 'down', '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '9',  symbol: 'NOW',  atrPct:  3.1, last:  1035.06, sector: 'Technology',         category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:   1940000, inForce: true,  ftfc: false, chgDollar:  26.54, chgPct:  2.63, atrDollar:  32.09, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '10', symbol: 'META', atrPct:  3.6, last:   656.38, sector: 'Technology',         category: 'Continuation+', signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:  20300000, inForce: true,  ftfc: false, chgDollar:  25.46, chgPct:  4.03, atrDollar:  23.63, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '11', symbol: 'TSLA', atrPct:  5.2, last:   346.56, sector: 'Consumer Cyclicals', category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30: 130000000, inForce: true,  ftfc: true,  chgDollar:  24.57, chgPct:  7.63, atrDollar:  18.02, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '12', symbol: 'APP',  atrPct:  6.8, last:   373.22, sector: 'Technology',         category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:   8350000, inForce: true,  ftfc: false, chgDollar:  22.66, chgPct:  6.47, atrDollar:  25.38, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '13', symbol: 'SMCX', atrPct: 12.0, last:    47.90, sector: '',                   category: 'Inside',        signal: 'Inside Up',       pattern: '1-2u',     cc2: '3',  cc1: '1',  cc: '2u', avgVol30:   4100000, inForce: true,  ftfc: true,  chgDollar:  20.88, chgPct: 43.59, atrDollar:   5.75, mtf: { '15': 'down', '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'down' } },
  { id: '14', symbol: 'LULU', atrPct:  3.8, last:   318.75, sector: 'Consumer Cyclicals', category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:   2500000, inForce: true,  ftfc: true,  chgDollar:  20.77, chgPct:  6.97, atrDollar:  12.11, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '15', symbol: 'GEV',  atrPct:  4.3, last:   433.88, sector: '',                   category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:   3690000, inForce: false, ftfc: false, chgDollar:  18.88, chgPct:  4.55, atrDollar:  18.66, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'down', Q: 'down', Y: 'down' } },
  { id: '16', symbol: 'NRG',  atrPct:  4.3, last:   154.06, sector: 'Utilities',          category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:   3020000, inForce: true,  ftfc: false, chgDollar:  17.06, chgPct: 12.45, atrDollar:   6.62, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '17', symbol: 'CRWD', atrPct:  4.2, last:   436.42, sector: 'Technology',         category: '',              signal: '3-2u Expansion',  pattern: '2u-3-1',   cc2: '2u', cc1: '3',  cc: '1',  avgVol30:   3940000, inForce: false, ftfc: false, chgDollar:  16.73, chgPct:  3.99, atrDollar:  18.33, mtf: { '15': 'down', '30': 'down', '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '18', symbol: 'RDDT', atrPct:  7.2, last:   129.05, sector: 'Technology',         category: '',              signal: '2-2-2 Green',     pattern: '2u-2d-2u', cc2: '2u', cc1: '2d', cc: '2u', avgVol30:   7890000, inForce: false, ftfc: false, chgDollar:  14.90, chgPct: 13.04, atrDollar:   9.29, mtf: { '15': 'up',   '30': 'down', '60': 'up',   D: 'down', W: 'up',   Q: 'up',   Y: 'down' } },
  { id: '19', symbol: 'NVDA', atrPct:  6.2, last:   112.45, sector: 'Technology',         category: 'Continuation+', signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30: 450000000, inForce: true,  ftfc: true,  chgDollar:  12.50, chgPct: 12.51, atrDollar:   6.97, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '20', symbol: 'AMAT', atrPct:  3.9, last:   178.32, sector: 'Technology',         category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:   8200000, inForce: true,  ftfc: false, chgDollar:  11.33, chgPct:  6.78, atrDollar:   6.95, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '21', symbol: 'PANW', atrPct:  4.1, last:   198.55, sector: 'Technology',         category: 'Inside',        signal: 'Inside Up',       pattern: '1-2u',     cc2: '2d', cc1: '1',  cc: '2u', avgVol30:   3600000, inForce: true,  ftfc: true,  chgDollar:   9.87, chgPct:  5.23, atrDollar:   8.14, mtf: { '15': 'down', '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '22', symbol: 'MELI', atrPct:  5.8, last:  2154.20, sector: 'Consumer Cyclicals', category: 'Continuation+', signal: '3-2u Expansion',  pattern: '3-2u',     cc2: '',   cc1: '3',  cc: '2u', avgVol30:    720000, inForce: true,  ftfc: false, chgDollar:   8.65, chgPct:  0.40, atrDollar: 124.94, mtf: { '15': 'down', '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
  { id: '23', symbol: 'CELH', atrPct:  8.5, last:    32.18, sector: 'Consumer Cyclicals', category: 'Continuation',  signal: '2-2 Up Cont.',    pattern: '2u-2u',    cc2: '2u', cc1: '2u', cc: '2u', avgVol30:   5100000, inForce: false, ftfc: false, chgDollar:   7.44, chgPct: 30.07, atrDollar:   2.74, mtf: { '15': 'up',   '30': 'up',   '60': 'up',   D: 'up',   W: 'up',   Q: 'down', Y: 'down' } },
  { id: '24', symbol: 'AXON', atrPct:  4.7, last:   728.45, sector: 'Industrials',        category: '',              signal: '3-1 Expansion',   pattern: '2u-3-1',   cc2: '2u', cc1: '3',  cc: '1',  avgVol30:   1250000, inForce: false, ftfc: false, chgDollar:   6.21, chgPct:  0.86, atrDollar:  34.24, mtf: { '15': 'down', '30': 'down', '60': 'up',   D: 'up',   W: 'up',   Q: 'up',   Y: 'up'   } },
]

export const QUICK_FILTERS: QuickFilter[] = [
  { id: 'reversals',   label: 'Reversals' },
  { id: 'hammers',     label: 'Hammers' },
  { id: 'shooters',    label: 'Shooters' },
  { id: 'inside-bars', label: 'Inside Bars' },
  { id: '2-2-up',      label: '2-2 Up Cont.' },
  { id: '2-2-down',    label: '2-2 Down Cont.' },
  { id: '2-down-green', label: '2 Down in Green' },
  { id: '2-up-red',    label: '2 Up in Red' },
  { id: 'in-force',    label: 'In Force' },
]

// ── Module-level reactive state (singleton) ─────────────────
const SCANNER_STATE_KEY = 'pulse-scanner-state'

interface ScannerPersistedState {
  timeframe: ScannerTimeframe
  mode: ScannerMode
  activeQuickFilter: string | null
  sortKey: keyof ScannerRow | null
  sortDir: SortDirection
}

function loadScannerState(): Partial<ScannerPersistedState> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SCANNER_STATE_KEY)
    return raw ? (JSON.parse(raw) as ScannerPersistedState) : {}
  } catch {
    return {}
  }
}

const timeframe = ref<ScannerTimeframe>('D')
const mode = ref<ScannerMode>('signal')
const activeQuickFilter = ref<string | null>(null)
const sortKey = ref<keyof ScannerRow | null>(null)
const sortDir = ref<SortDirection>(null)

function persistScannerState() {
  if (typeof window === 'undefined') return
  const state: ScannerPersistedState = {
    timeframe: timeframe.value,
    mode: mode.value,
    activeQuickFilter: activeQuickFilter.value,
    sortKey: sortKey.value,
    sortDir: sortDir.value,
  }
  localStorage.setItem(SCANNER_STATE_KEY, JSON.stringify(state))
}

function initScanner() {
  const ps = loadScannerState()
  timeframe.value = ps.timeframe ?? 'D'
  mode.value = ps.mode ?? 'signal'
  activeQuickFilter.value = ps.activeQuickFilter ?? null
  sortKey.value = ps.sortKey ?? null
  sortDir.value = ps.sortDir ?? null
}


// ── Computed ────────────────────────────────────────────────
const filteredRows = computed<ScannerRow[]>(() => {
  let rows = [...MOCK_ROWS]

  if (activeQuickFilter.value) {
    const f = activeQuickFilter.value
    if (f === 'inside-bars')   rows = rows.filter(r => r.category === 'Inside')
    else if (f === 'hammers')  rows = rows.filter(r => r.signal.toLowerCase().includes('hammer'))
    else if (f === 'shooters') rows = rows.filter(r => r.signal.toLowerCase().includes('shooter'))
    else if (f === 'reversals') rows = rows.filter(r => r.category === 'Reversal')
    else if (f === '2-2-up')   rows = rows.filter(r => r.signal.includes('2-2 Up'))
    else if (f === '2-2-down') rows = rows.filter(r => r.signal.includes('2-2 Down') || r.signal.includes('Down Cont'))
    else if (f === '2-down-green') rows = rows.filter(r => r.signal.includes('Green') || r.signal.includes('2d Green'))
    else if (f === '2-up-red') rows = rows.filter(r => r.signal.includes('Red'))
    else if (f === 'in-force') rows = rows.filter(r => r.inForce)
  }

  if (sortKey.value && sortDir.value) {
    const key = sortKey.value
    const dir = sortDir.value
    rows.sort((a, b) => {
      const av = a[key] as number | string | boolean
      const bv = b[key] as number | string | boolean
      if (typeof av === 'number' && typeof bv === 'number') {
        return dir === 'asc' ? av - bv : bv - av
      }
      const as = String(av)
      const bs = String(bv)
      return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
  }

  return rows
})

const totalCount = computed(() => MOCK_ROWS.length)
const showingCount = computed(() => filteredRows.value.length)

// ── Actions ─────────────────────────────────────────────────
function setTimeframe(tf: ScannerTimeframe) {
  timeframe.value = tf
  persistScannerState()
}

function setMode(m: ScannerMode) {
  mode.value = m
  persistScannerState()
}

function toggleQuickFilter(filterId: string) {
  activeQuickFilter.value = activeQuickFilter.value === filterId ? null : filterId
  persistScannerState()
}

function clearFilters() {
  activeQuickFilter.value = null
  persistScannerState()
}

function setSortBy(key: keyof ScannerRow) {
  if (sortKey.value === key) {
    if (sortDir.value === 'asc') sortDir.value = 'desc'
    else if (sortDir.value === 'desc') { sortDir.value = null; sortKey.value = null }
    else sortDir.value = 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
  persistScannerState()
}

export function useScanner() {
  return {
    // State
    timeframe,
    mode,
    activeQuickFilter,
    sortKey,
    sortDir,
    // Computed
    filteredRows,
    totalCount,
    showingCount,
    // Raw data (for column filter unique values)
    allRows: MOCK_ROWS,
    // Actions
    setTimeframe,
    setMode,
    toggleQuickFilter,
    clearFilters,
    setSortBy,
    // Constants
    QUICK_FILTERS,
    // Init
    initScanner,
  }
}
