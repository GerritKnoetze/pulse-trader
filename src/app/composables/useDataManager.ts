import { ref } from 'vue'

// ── Shared types ──────────────────────────────────────────────────────────────

export type DataTab = 'overview' | 'cache' | 'db' | 'upstream' | 'live'

export interface DataBarRow {
  id: string | null
  ticker: string
  timespan: string
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  transactions: number | null
  createdAt: string | null
  source: 'cache' | 'db'
}

export interface DataBatch {
  date: string
  count: number
  minTs: number
  maxTs: number
}

export interface DataSeries {
  ticker: string
  timespan: string
  count: number
  minTs: number | null
  maxTs: number | null
  cached: boolean
  cacheCount: number
  sync: {
    Ticker: string
    Timespan: string
    LatestTimestamp: number
    LastSyncAt: string | null
    GapStart: number | null
    GapEnd: number | null
    SyncError: string | null
  } | null
}

// ── Module-level shared state (drill-down across panels) ──────────────────────

const activeTab = ref<DataTab>('overview')
const selectedSeries = ref<{ ticker: string; timespan: string } | null>(null)
const selectedBatch = ref<string | null>(null)
const refreshTick = ref(0)

// Named exports so panels can also watch the shared refs directly.
export { activeTab, selectedSeries, selectedBatch, refreshTick }

/** Switch tab (optionally pre-selecting a series/batch to drill into). */
function navigate(
  tab: DataTab,
  opts?: { series?: { ticker: string; timespan: string } | null; batch?: string | null },
) {
  activeTab.value = tab
  if (opts) {
    if (opts.series !== undefined) selectedSeries.value = opts.series
    if (opts.batch !== undefined) selectedBatch.value = opts.batch
  }
}

/** Bump so active panels refetch their data. */
function bumpRefresh() { refreshTick.value++ }

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchOverview() {
  return (await $fetch<{ success: boolean; data: any }>('/api/data-manager/overview')).data
}

async function fetchCacheSnapshot() {
  return (await $fetch<{ success: boolean; data: any }>('/api/data-manager/cache')).data
}

async function fetchSeries() {
  return (await $fetch<{ success: boolean; data: DataSeries[] }>('/api/data-manager/series')).data
}

async function fetchBatches(ticker: string, timespan: string) {
  return (await $fetch<{ success: boolean; data: DataBatch[] }>(
    `/api/data-manager/batches?ticker=${encodeURIComponent(ticker)}&timespan=${encodeURIComponent(timespan)}`,
  )).data
}

async function fetchRows(ticker: string, timespan: string, opts: {
  source?: 'cache' | 'db'
  from?: number
  to?: number
  limit?: number
} = {}) {
  const params = new URLSearchParams({
    ticker,
    timespan,
    source: opts.source ?? 'db',
  })
  if (opts.from !== undefined) params.set('from', String(opts.from))
  if (opts.to !== undefined) params.set('to', String(opts.to))
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  return (await $fetch<{ success: boolean; data: DataBarRow[] }>(`/api/data-manager/rows?${params.toString()}`)).data
}

async function saveRow(input: Partial<DataBarRow> & {
  ticker: string
  timespan: string
  timestamp: number
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number
  transactions?: number | null
}) {
  return await $fetch<{ success: boolean; data: { ok: boolean; id: string | null; updated: boolean } }>(
    '/api/data-manager/row',
    { method: 'POST', body: input },
  )
}

async function removeRow(input: { id?: string; ticker: string; timespan: string; timestamp?: number }) {
  return await $fetch<{ success: boolean; data: { ok: boolean; deleted: number } }>(
    '/api/data-manager/row',
    { method: 'DELETE', body: input },
  )
}

async function removeBatch(ticker: string, timespan: string, date: string) {
  return await $fetch<{ success: boolean; data: { ok: boolean; deleted: number } }>(
    '/api/data-manager/row',
    { method: 'DELETE', body: { ticker, timespan, batchDate: date } },
  )
}

async function cacheFlush(opts: { scope?: 'candles' | 'snapshot' | 'rows' | 'all'; ticker?: string; timespan?: string } = {}) {
  return await $fetch<{ success: boolean; data: { candlesRemoved: number; snapshotInvalidated: boolean; rowsCleared: number } }>(
    '/api/data-manager/cache-flush',
    { method: 'POST', body: { scope: opts.scope ?? 'candles', ticker: opts.ticker, timespan: opts.timespan } },
  )
}

async function cacheRefresh(ticker: string, timespan: string) {
  return await $fetch<{ success: boolean; data: { ticker: string; timespan: string; cached: number; stored: number; seeded: boolean; error?: string } }>(
    '/api/data-manager/cache-refresh',
    { method: 'POST', body: { ticker, timespan } },
  )
}

async function dbFlush(opts: { all?: boolean; ticker?: string; timespan?: string; confirm?: string } = {}) {
  return await $fetch<{ success: boolean; data: { deleted: number } }>(
    '/api/data-manager/db-flush',
    { method: 'POST', body: opts },
  )
}

async function downloadHistory(opts: {
  tickers: string[]
  timespan: string
  multiplier?: number
  from: string
  to: string
}) {
  return await $fetch<{ success: boolean; data: Array<{ ticker: string; bars: number; error?: string }> }>(
    '/api/data-manager/download',
    { method: 'POST', body: opts },
  )
}

async function validateConnection() {
  return (await $fetch<{ success: boolean; data: { valid: boolean; message: string } }>(
    '/api/market-data/validate',
    { method: 'POST' },
  )).data
}

// ── Export ────────────────────────────────────────────────────────────────────

export function useDataManager() {
  return {
    activeTab,
    selectedSeries,
    selectedBatch,
    refreshTick,
    navigate,
    bumpRefresh,
    fetchOverview,
    fetchCacheSnapshot,
    fetchSeries,
    fetchBatches,
    fetchRows,
    saveRow,
    removeRow,
    removeBatch,
    cacheFlush,
    cacheRefresh,
    dbFlush,
    downloadHistory,
    validateConnection,
  }
}
