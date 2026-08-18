<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  ArrowPathIcon,
  ChevronRightIcon,
  TrashIcon,
  EyeIcon,
  CircleStackIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import {
  useDataManager, selectedSeries, selectedBatch, type DataSeries, type DataBatch, type DataBarRow,
} from '~/composables/useDataManager'
import { useToast } from '~/composables/useToast'
import { formatTs, formatNum, formatCompact } from '~/utils/data-format'
import DataBarTable from './DataBarTable.vue'

const {
  fetchSeries, fetchBatches, fetchRows, dbFlush, cacheRefresh, removeBatch, refreshTick,
} = useDataManager()
const toast = useToast()

const series = ref<DataSeries[]>([])
const batches = ref<DataBatch[]>([])
const rows = ref<DataBarRow[]>([])
const loading = ref(false)
const busy = ref<string | null>(null)
const error = ref<string | null>(null)
const rowsLoading = ref(false)
const confirmFullFlush = ref(false)

const currentSeries = ref<{ ticker: string; timespan: string } | null>(null)
const currentBatch = ref<string | null>(null)

// ── Breadcrumb state (drill level) ────────────────────────────────────────────
const view = computed(() => {
  if (currentSeries.value && currentBatch.value) return 'rows'
  if (currentSeries.value) return 'batches'
  return 'series'
})

async function loadSeries() {
  loading.value = true
  try {
    series.value = await fetchSeries()
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load series'
  } finally {
    loading.value = false
  }
}

async function openSeries(ticker: string, timespan: string) {
  currentSeries.value = { ticker, timespan }
  currentBatch.value = null
  selectedSeries.value = { ticker, timespan }
  selectedBatch.value = null
  batches.value = []
  try {
    batches.value = await fetchBatches(ticker, timespan)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to load batches')
  }
}

async function openBatch(date: string) {
  if (!currentSeries.value) return
  currentBatch.value = date
  selectedBatch.value = date
  rowsLoading.value = true
  const batch = batches.value.find(b => b.date === date)
  try {
    rows.value = await fetchRows(currentSeries.value.ticker, currentSeries.value.timespan, {
      source: 'db',
      from: batch?.minTs,
      to: batch?.maxTs,
    })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to load rows')
  } finally {
    rowsLoading.value = false
  }
}

function back() {
  if (currentBatch.value) {
    currentBatch.value = null
    selectedBatch.value = null
    return
  }
  if (currentSeries.value) {
    currentSeries.value = null
    selectedSeries.value = null
    return
  }
}

async function onRowsChanged() {
  await loadSeries()
  if (currentSeries.value) {
    try { batches.value = await fetchBatches(currentSeries.value.ticker, currentSeries.value.timespan) } catch { /* ignore */ }
    if (currentBatch.value) {
      const batch = batches.value.find(b => b.date === currentBatch.value)
      rows.value = await fetchRows(currentSeries.value.ticker, currentSeries.value.timespan, {
        source: 'db',
        from: batch?.minTs,
        to: batch?.maxTs,
      })
    }
  }
}

async function deleteBatch(date: string) {
  if (!currentSeries.value) return
  busy.value = `batch:${date}`
  try {
    const res = await removeBatch(currentSeries.value.ticker, currentSeries.value.timespan, date)
    toast.success(`Deleted ${res.data.deleted} bar(s) from ${date}`)
    await onRowsChanged()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to delete batch')
  } finally {
    busy.value = null
  }
}

async function flushSeries(ticker: string, timespan: string) {
  busy.value = `flush:${ticker}:${timespan}`
  try {
    const res = await dbFlush({ ticker, timespan })
    toast.success(`Removed ${res.data.deleted} bars from ${ticker} ${timespan}`)
    if (currentSeries.value?.ticker === ticker && currentSeries.value?.timespan === timespan) back()
    await loadSeries()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Flush failed')
  } finally {
    busy.value = null
  }
}

async function refreshSeries(ticker: string, timespan: string) {
  busy.value = `refresh:${ticker}:${timespan}`
  try {
    const res = await cacheRefresh(ticker, timespan)
    toast.success(`${ticker} ${timespan} — ${res.data.cached} cached, ${res.data.stored} stored${res.data.error ? ` (${res.data.error})` : ''}`)
    await loadSeries()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Refresh failed')
  } finally {
    busy.value = null
  }
}

async function flushFullDb() {
  busy.value = 'full-flush'
  try {
    const res = await dbFlush({ all: true, confirm: 'flush-all' })
    toast.success(`Full DB flush — removed ${res.data.deleted} bars`)
    currentSeries.value = null
    currentBatch.value = null
    await loadSeries()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Flush failed')
  } finally {
    busy.value = null
    confirmFullFlush.value = false
  }
}

onMounted(() => {
  void loadSeries()
  if (selectedSeries.value) void openSeries(selectedSeries.value.ticker, selectedSeries.value.timespan)
  if (selectedBatch.value && currentSeries.value) void openBatch(selectedBatch.value)
})
watch(refreshTick, () => { void loadSeries() })
watch(selectedSeries, (s) => {
  if (s && (!currentSeries.value || currentSeries.value.ticker !== s.ticker || currentSeries.value.timespan !== s.timespan)) {
    void openSeries(s.ticker, s.timespan)
  }
}, { deep: true })
watch(selectedBatch, (d) => {
  if (d && currentSeries.value && d !== currentBatch.value) void openBatch(d)
})

const seriesLabel = computed(() => currentSeries.value ? `${currentSeries.value.ticker} · ${currentSeries.value.timespan}` : '')
const curSeries = computed(() => currentSeries.value ?? { ticker: '', timespan: '' })
const curBatch = computed(() => currentBatch.value ?? '')
</script>

<template>
  <div class="dm-panel">
    <div v-if="error" class="dm-error">
      {{ error }}
      <button class="btn btn-secondary btn-sm" @click="loadSeries">Retry</button>
    </div>

    <!-- Toolbar -->
    <div class="panel-toolbar">
      <h2 class="panel-title">L2 · SQLite database</h2>
      <button class="btn btn-secondary btn-sm" @click="loadSeries">
        <ArrowPathIcon class="btn-icon" />
        Refresh
      </button>
      <template v-if="!confirmFullFlush">
        <button class="btn btn-danger btn-sm" @click="confirmFullFlush = true">
          <TrashIcon class="btn-icon" />
          Flush entire DB
        </button>
      </template>
      <div v-else class="confirm-inline">
        <span>Delete ALL bars + sync state? Cannot be undone.</span>
        <button class="btn btn-danger btn-sm" :disabled="!!busy" @click="flushFullDb">Yes, delete all</button>
        <button class="btn btn-secondary btn-sm" @click="confirmFullFlush = false">
          <XMarkIcon class="btn-icon" />
        </button>
      </div>
    </div>

    <!-- Breadcrumb -->
    <div v-if="view !== 'series'" class="breadcrumb">
      <button class="crumb" @click="back">
        <CircleStackIcon class="btn-icon" />
        All series
      </button>
      <ChevronRightIcon class="crumb-chevron" />
      <span class="crumb current">{{ seriesLabel }}</span>
      <template v-if="view === 'rows'">
        <ChevronRightIcon class="crumb-chevron" />
        <button class="crumb" @click="back">{{ currentBatch }}</button>
      </template>
    </div>

    <!-- ── Series view ─────────────────────────────────────────────────── -->
    <template v-if="view === 'series'">
      <div class="section-header">
        <h3>Series ({{ series.length }}) — every stored ticker × timespan</h3>
        <span class="hint">Click a row to drill into its daily batches → bars</span>
      </div>
      <div v-if="series.length === 0" class="muted-center">
        No market data stored. Run a scan, sync a symbol, or download history (L3 tab).
      </div>
      <div v-else class="sub-card no-pad">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Timespan</th>
              <th class="num">Bars</th>
              <th>Earliest (ET)</th>
              <th>Latest (ET)</th>
              <th>Cache</th>
              <th>Sync state</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in series" :key="`${s.ticker}:${s.timespan}`" :class="{ clickable: true }" @click="openSeries(s.ticker, s.timespan)">
              <td class="mono strong">{{ s.ticker }}</td>
              <td class="mono">{{ s.timespan }}</td>
              <td class="num mono">{{ formatNum(s.count, 0) }}</td>
              <td class="mono">{{ s.minTs ? formatTs(s.minTs) : '—' }}</td>
              <td class="mono">{{ s.maxTs ? formatTs(s.maxTs) : '—' }}</td>
              <td>
                <span v-if="s.cached" class="cache-badge">{{ s.cacheCount }} in mem</span>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <span v-if="s.sync?.SyncError" class="sync-err" :title="s.sync.SyncError">error</span>
                <span v-else-if="s.sync" class="mono sync-ok">{{ s.sync.LatestTimestamp ? formatTs(s.sync.LatestTimestamp) : '—' }}</span>
                <span v-else class="muted">none</span>
              </td>
              <td @click.stop>
                <div class="row-actions">
                  <button class="row-btn" title="Drill into batches" @click="openSeries(s.ticker, s.timespan)">
                    <EyeIcon class="btn-icon" />
                  </button>
                  <button class="row-btn" title="Re-sync from API" :disabled="!!busy" @click="refreshSeries(s.ticker, s.timespan)">
                    <ArrowPathIcon class="btn-icon" :class="{ spin: busy === `refresh:${s.ticker}:${s.timespan}` }" />
                  </button>
                  <button class="row-btn danger" title="Delete all bars for this series" :disabled="!!busy" @click="flushSeries(s.ticker, s.timespan)">
                    <TrashIcon class="btn-icon" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ── Daily batches view ──────────────────────────────────────────── -->
    <template v-else-if="view === 'batches'">
      <div class="section-header">
        <h3>Daily batches — {{ seriesLabel }}</h3>
        <button class="btn btn-secondary btn-sm" @click="openSeries(curSeries.ticker, curSeries.timespan)">
          <ArrowPathIcon class="btn-icon" />
          Reload batches
        </button>
      </div>
      <div v-if="batches.length === 0" class="muted-center">No batches for this series.</div>
      <div v-else class="sub-card no-pad">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date (ET)</th>
              <th class="num">Bars</th>
              <th>Start (ET)</th>
              <th>End (ET)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in batches" :key="b.date" :class="{ clickable: true }" @click="openBatch(b.date)">
              <td class="mono strong">{{ b.date }}</td>
              <td class="num mono">{{ formatNum(b.count, 0) }}</td>
              <td class="mono">{{ formatTs(b.minTs) }}</td>
              <td class="mono">{{ formatTs(b.maxTs) }}</td>
              <td @click.stop>
                <div class="row-actions">
                  <button class="row-btn" title="View bars" @click="openBatch(b.date)">
                    <EyeIcon class="btn-icon" />
                  </button>
                  <button class="row-btn danger" title="Delete batch" :disabled="!!busy" @click="deleteBatch(b.date)">
                    <TrashIcon class="btn-icon" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ── Rows view ───────────────────────────────────────────────────── -->
    <template v-else>
      <div class="section-header">
        <h3>Bars — {{ seriesLabel }} · {{ curBatch }}</h3>
        <button class="btn btn-secondary btn-sm" @click="openBatch(curBatch)">
          <ArrowPathIcon class="btn-icon" />
          Reload
        </button>
      </div>
      <div v-if="rowsLoading" class="muted-center">Loading rows…</div>
      <DataBarTable
        v-else
        :ticker="curSeries.ticker"
        :timespan="curSeries.timespan"
        source="db"
        :rows="rows"
        @changed="onRowsChanged"
      />
    </template>
  </div>
</template>

<style scoped>
.dm-panel { display: flex; flex-direction: column; gap: 1.25rem; }
.panel-toolbar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.panel-title { margin: 0; font-size: 1rem; font-weight: 600; flex: 1; }
.dm-error {
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  color: var(--color-danger);
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.section-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.section-header h3 { margin: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-soft); }
.hint { font-size: 0.72rem; color: var(--color-text-soft); opacity: 0.7; }
.muted-center { color: var(--color-text-soft); opacity: 0.7; text-align: center; padding: 1.25rem; }
.sub-card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 0.9rem 1rem;
  min-width: 0;
}
.sub-card.no-pad { padding: 0; overflow: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.data-table th { text-align: left; padding: 0.45rem 0.6rem; color: var(--color-text-soft); border-bottom: 1px solid var(--color-border); font-weight: 600; white-space: nowrap; }
.data-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
.data-table tbody tr:hover { background: var(--color-background-mute); }
.clickable { cursor: pointer; }
.num { text-align: right; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
.strong { font-weight: 600; }
.muted { color: var(--color-text-soft); opacity: 0.6; }
.cache-badge {
  color: #e5a00d;
  background: rgba(229, 160, 13, 0.1);
  border: 1px solid rgba(229, 160, 13, 0.3);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  font-size: 0.68rem;
  white-space: nowrap;
}
.sync-err { color: #f87171; font-size: 0.72rem; }
.sync-ok { color: #4ade80; }
.row-actions { display: flex; gap: 0.3rem; }
.row-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
}
.row-btn:hover { color: var(--color-text); background: var(--color-background-mute); }
.row-btn.danger:hover { color: var(--color-danger); border-color: var(--color-danger); }
.row-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.breadcrumb { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; }
.crumb {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0;
  font-size: 0.82rem;
}
.crumb:hover { text-decoration: underline; }
.crumb.current { color: var(--color-text); cursor: default; }
.crumb.current:hover { text-decoration: none; }
.crumb-chevron { width: 0.8rem; height: 0.8rem; color: var(--color-text-soft); opacity: 0.5; }
.confirm-inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border: 1px solid rgba(255, 77, 79, 0.35);
  border-radius: var(--radius-md);
  padding: 0.4rem 0.6rem;
}
.btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }
</style>
