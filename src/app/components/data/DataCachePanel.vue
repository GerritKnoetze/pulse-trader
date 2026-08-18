<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import {
  ArrowPathIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import { useDataManager, type DataBarRow } from '~/composables/useDataManager'
import { useToast } from '~/composables/useToast'
import { formatTs, formatNum, formatDuration, formatCompact } from '~/utils/data-format'
import DataBarTable from './DataBarTable.vue'
import DataStatCard from './DataStatCard.vue'

const {
  fetchCacheSnapshot, fetchRows, cacheFlush, cacheRefresh, refreshTick,
} = useDataManager()
const toast = useToast()

const snapshot = ref<any>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const expanded = ref<string | null>(null)
const expandedBars = ref<Record<string, DataBarRow[]>>({})
const expandedLoading = ref(false)
const busy = ref<string | null>(null)
const confirmFlushAll = ref(false)

let timer: ReturnType<typeof setInterval> | null = null

async function load() {
  if (loading.value) return
  loading.value = true
  try {
    snapshot.value = await fetchCacheSnapshot()
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load cache snapshot'
  } finally {
    loading.value = false
  }
}

const totalCandleBars = computed(() =>
  (snapshot.value?.candleEntries ?? []).reduce((n: number, e: any) => n + e.count, 0),
)

const expiredCount = computed(() =>
  (snapshot.value?.candleEntries ?? []).filter((e: any) => e.expired).length,
)

function toggleExpand(ticker: string, timespan: string) {
  const key = `${ticker}:${timespan}`
  if (expanded.value === key) {
    expanded.value = null
    return
  }
  expanded.value = key
  if (!expandedBars.value[key]) {
    loadExpanded(ticker, timespan)
  }
}

async function loadExpanded(ticker: string, timespan: string) {
  const key = `${ticker}:${timespan}`
  expandedLoading.value = true
  try {
    const bars = await fetchRows(ticker, timespan, { source: 'cache' })
    expandedBars.value = { ...expandedBars.value, [key]: bars }
  } catch {
    expandedBars.value = { ...expandedBars.value, [key]: [] }
  } finally {
    expandedLoading.value = false
  }
}

async function reloadExpandedIfOpen() {
  const key = expanded.value
  if (!key) return
  const sep = key.lastIndexOf(':')
  await loadExpanded(key.slice(0, sep), key.slice(sep + 1))
}

async function refreshEntry(ticker: string, timespan: string) {
  busy.value = `refresh:${ticker}:${timespan}`
  try {
    const res = await cacheRefresh(ticker, timespan)
    toast.success(`${ticker} ${timespan} refreshed — ${res.data.cached} bars cached, ${res.data.stored} stored`)
    await load()
    await reloadExpandedIfOpen()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Refresh failed')
  } finally {
    busy.value = null
  }
}

async function flushEntry(ticker: string, timespan: string) {
  busy.value = `flush:${ticker}:${timespan}`
  try {
    const res = await cacheFlush({ scope: 'candles', ticker, timespan })
    toast.success(`Flushed ${res.data.candlesRemoved} cached bars`)
    if (expanded.value === `${ticker}:${timespan}`) expanded.value = null
    await load()  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Flush failed')
  } finally {
    busy.value = null
  }
}

async function flushAll() {
  busy.value = 'flush-all'
  try {
    const res = await cacheFlush({ scope: 'all' })
    toast.success(`Cache flushed — ${res.data.candlesRemoved} bars, ${res.data.rowsCleared} rows cleared`)
    expanded.value = null
    await load()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Flush failed')
  } finally {
    busy.value = null
    confirmFlushAll.value = false
  }
}

onMounted(() => {
  void load()
  timer = setInterval(() => { void load() }, 5000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
watch(refreshTick, () => { void load() })
</script>

<template>
  <div class="dm-panel">
    <div v-if="error" class="dm-error">
      {{ error }}
      <button class="btn btn-secondary btn-sm" @click="load">Retry</button>
    </div>

    <template v-if="snapshot">
      <div class="panel-toolbar">
        <h2 class="panel-title">L1 · In-memory cache</h2>
        <button class="btn btn-secondary btn-sm" @click="load">
          <ArrowPathIcon class="btn-icon" />
          Refresh
        </button>
        <template v-if="!confirmFlushAll">
          <button class="btn btn-danger btn-sm" :disabled="!!busy" @click="confirmFlushAll = true">
            <TrashIcon class="btn-icon" />
            Flush all caches
          </button>
        </template>
        <div v-else class="confirm-inline">
          <span>Flush ALL caches? Rows will re-enrich on next scan.</span>
          <button class="btn btn-danger btn-sm" :disabled="!!busy" @click="flushAll">Yes, flush</button>
          <button class="btn btn-secondary btn-sm" @click="confirmFlushAll = false">
            <XMarkIcon class="btn-icon" />
          </button>
        </div>
      </div>

      <div class="stat-grid">
        <DataStatCard label="Candle cache entries" :value="snapshot.candleEntries.length" :sub="`${formatCompact(totalCandleBars)} bars total`" accent="amber" />
        <DataStatCard label="Expired entries" :value="expiredCount" accent="red" />
        <DataStatCard label="Scanner row cache" :value="snapshot.rowCache.length" sub="rows enriched in memory" accent="green" />
        <DataStatCard label="WS subscriptions" :value="snapshot.ws.subscriptions" :sub="`status: ${snapshot.ws.status}`" accent="blue" />
      </div>

      <!-- Candle cache entries -->
      <section class="dm-section">
        <div class="section-header">
          <h3>Candle cache entries ({{ snapshot.candleEntries.length }})</h3>
          <span class="hint">TTL-based entries; expired entries are served as misses and evicted on access</span>
        </div>
        <div v-if="snapshot.candleEntries.length === 0" class="muted-center">No candle cache entries — open charts or run a scan to populate.</div>
        <div v-else class="sub-card no-pad">
          <table class="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Ticker</th>
                <th>Timespan</th>
                <th class="num">Bars</th>
                <th>First (ET)</th>
                <th>Last (ET)</th>
                <th>TTL left</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="e in snapshot.candleEntries" :key="`${e.ticker}:${e.timespan}`">
                <tr :class="{ expired: e.expired }">
                  <td>
                    <button class="expand-btn" @click="toggleExpand(e.ticker, e.timespan)">
                      <ChevronRightIcon v-if="expanded !== `${e.ticker}:${e.timespan}`" class="btn-icon" />
                      <ChevronDownIcon v-else class="btn-icon" />
                    </button>
                  </td>
                  <td class="mono">{{ e.ticker }}</td>
                  <td class="mono">{{ e.timespan }}</td>
                  <td class="num mono">{{ formatNum(e.count, 0) }}</td>
                  <td class="mono">{{ e.firstTs ? formatTs(e.firstTs) : '—' }}</td>
                  <td class="mono">{{ e.lastTs ? formatTs(e.lastTs) : '—' }}</td>
                  <td>
                    <span v-if="e.expired" class="expired-badge">expired</span>
                    <span v-else class="mono">{{ formatDuration(e.ttlRemainingMs) }}</span>
                  </td>
                  <td>
                    <div class="row-actions">
                      <button class="row-btn" title="View bars" @click="toggleExpand(e.ticker, e.timespan)">
                        <EyeIcon class="btn-icon" />
                      </button>
                      <button class="row-btn" title="Re-sync from L2/L3" :disabled="!!busy" @click="refreshEntry(e.ticker, e.timespan)">
                        <ArrowPathIcon class="btn-icon" :class="{ spin: busy === `refresh:${e.ticker}:${e.timespan}` }" />
                      </button>
                      <button class="row-btn danger" title="Flush entry" :disabled="!!busy" @click="flushEntry(e.ticker, e.timespan)">
                        <TrashIcon class="btn-icon" />
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="expanded === `${e.ticker}:${e.timespan}`" class="expanded-row">
                  <td colspan="8">
                    <div v-if="expandedLoading" class="muted-center">Loading cache bars…</div>
                    <DataBarTable
                      v-else
                      :ticker="e.ticker"
                      :timespan="e.timespan"
                      source="cache"
                      :rows="expandedBars[`${e.ticker}:${e.timespan}`] ?? []"
                      @changed="load"
                    />
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Snapshot + rows -->
      <section class="dm-section">
        <div class="section-header">
          <h3>Other caches</h3>
        </div>
        <div class="breakdown-grid">
          <div class="sub-card">
            <div class="sub-card-head">
              <h4>Market snapshot</h4>
              <button class="row-btn" title="Invalidate snapshot cache" @click="cacheFlush({ scope: 'snapshot' }).then(load).then(() => toast.success('Snapshot cache invalidated'))">
                <TrashIcon class="btn-icon" />
              </button>
            </div>
            <div class="kv-list">
              <div class="kv"><span>Tickers</span><span class="mono">{{ snapshot.snapshot.tickerCount }}</span></div>
              <div class="kv"><span>Fetched</span><span class="mono">{{ snapshot.snapshot.fetchedAt ? formatTs(snapshot.snapshot.fetchedAt) : 'never' }}</span></div>
              <div class="kv"><span>Session TTL</span><span class="mono">{{ formatDuration(snapshot.snapshot.ttlMs) }}</span></div>
              <div class="kv"><span>Stale</span><span class="mono">{{ snapshot.snapshot.staleMs != null ? formatDuration(snapshot.snapshot.staleMs) : 'n/a' }}</span></div>
            </div>
          </div>
          <div class="sub-card">
            <div class="sub-card-head">
              <h4>Scanner row cache</h4>
              <span class="hint">{{ snapshot.rowCache.length }} rows</span>
            </div>
            <div v-if="snapshot.rowCache.length === 0" class="muted-center">Empty — run a scan.</div>
            <div v-else class="mini-scroll">
              <table class="data-table">
                <thead>
                  <tr><th>Symbol</th><th class="num">Last</th><th class="num">Chg%</th><th>Enrich</th><th>Live</th></tr>
                </thead>
                <tbody>
                  <tr v-for="r in snapshot.rowCache.slice(0, 40)" :key="r.symbol">
                    <td class="mono">{{ r.symbol }}</td>
                    <td class="num mono">{{ formatNum(r.last) }}</td>
                    <td class="num mono" :class="r.chgPct >= 0 ? 'up' : 'down'">{{ formatNum(r.chgPct) }}</td>
                    <td class="mono">{{ r.enrichLevel }}</td>
                    <td><span class="ws-dot" :class="r.wsActive ? 'on' : 'off'" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- Intraday + 10s + watched -->
      <section class="dm-section">
        <div class="section-header">
          <h3>Live WS state</h3>
        </div>
        <div class="breakdown-grid">
          <div class="sub-card">
            <div class="sub-card-head">
              <h4>Intraday ({{ snapshot.intraday.length }})</h4>
            </div>
            <div v-if="snapshot.intraday.length === 0" class="muted-center">No live intraday states — enable the live feed + scan.</div>
            <div v-else class="mini-scroll">
              <table class="data-table">
                <thead>
                  <tr><th>Symbol</th><th class="num">Last</th><th class="num">Vol</th><th>1</th><th>5</th><th>D</th><th>W</th><th>M/Q/Y</th></tr>
                </thead>
                <tbody>
                  <tr v-for="s in snapshot.intraday.slice(0, 40)" :key="s.symbol">
                    <td class="mono">{{ s.symbol }}</td>
                    <td class="num mono">{{ formatNum(s.lastPrice) }}</td>
                    <td class="num mono">{{ formatCompact(s.accVolume) }}</td>
                    <td class="dir" :class="s.dir1">{{ s.dir1 }}</td>
                    <td class="dir" :class="s.dir5">{{ s.dir5 }}</td>
                    <td class="dir" :class="s.dirD">{{ s.dirD }}</td>
                    <td class="dir" :class="s.dirW">{{ s.dirW }}</td>
                    <td class="dir">{{ [s.dirM, s.dirQ, s.dirY].filter(Boolean).join('/') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="sub-card">
            <div class="sub-card-head">
              <h4>10s buckets ({{ snapshot.tenSec.length }}) · Watched ({{ snapshot.watched.length }})</h4>
            </div>
            <div class="chips">
              <span v-for="sym in snapshot.watched" :key="sym" class="chip">{{ sym }}</span>
              <span v-if="snapshot.watched.length === 0" class="muted-center">No watched chart symbols.</span>
            </div>
            <div v-if="snapshot.tenSec.length > 0" class="mini-scroll">
              <table class="data-table">
                <thead>
                  <tr><th>Symbol</th><th>Bucket (ET)</th><th class="num">O</th><th class="num">H</th><th class="num">L</th><th class="num">C</th></tr>
                </thead>
                <tbody>
                  <tr v-for="b in snapshot.tenSec.slice(-30).reverse()" :key="`${b.ticker}:${b.timestamp}`">
                    <td class="mono">{{ b.ticker }}</td>
                    <td class="mono">{{ formatTs(b.timestamp) }}</td>
                    <td class="num mono">{{ formatNum(b.open) }}</td>
                    <td class="num mono">{{ formatNum(b.high) }}</td>
                    <td class="num mono">{{ formatNum(b.low) }}</td>
                    <td class="num mono">{{ formatNum(b.close) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </template>

    <div v-else class="dm-loading">Loading cache snapshot…</div>
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
.dm-loading { color: var(--color-text-soft); padding: 2rem; text-align: center; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; }
.dm-section { display: flex; flex-direction: column; gap: 0.75rem; }
.section-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.section-header h3 { margin: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-soft); }
.hint { font-size: 0.72rem; color: var(--color-text-soft); opacity: 0.7; }
.breakdown-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
@media (max-width: 900px) { .breakdown-grid { grid-template-columns: 1fr; } }
.sub-card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 0.9rem 1rem;
  min-width: 0;
}
.sub-card.no-pad { padding: 0; overflow: auto; }
.sub-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem; }
.sub-card h4 { margin: 0; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-soft); }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.data-table th { text-align: left; padding: 0.45rem 0.5rem; color: var(--color-text-soft); border-bottom: 1px solid var(--color-border); font-weight: 600; white-space: nowrap; }
.data-table td { padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
.data-table tbody tr:hover { background: var(--color-background-mute); }
.num { text-align: right; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
.muted-center { color: var(--color-text-soft); opacity: 0.7; text-align: center; padding: 0.75rem; }
.expired { opacity: 0.55; }
.expired-badge {
  color: #f87171;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  font-size: 0.68rem;
}
.expand-btn { background: none; border: none; color: var(--color-text-soft); cursor: pointer; display: flex; padding: 0.2rem; }
.expand-btn:hover { color: var(--color-text); }
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
.expanded-row td { padding: 0.75rem 1rem; background: var(--color-background); }
.up { color: #4ade80; }
.down { color: #f87171; }
.dir { text-transform: uppercase; font-size: 0.7rem; font-weight: 600; }
.dir.up { color: #4ade80; }
.dir.down { color: #f87171; }
.ws-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; }
.ws-dot.on { background: #4ade80; }
.ws-dot.off { background: #444; }
.mini-scroll { max-height: 30vh; overflow: auto; }
.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.6rem; }
.chip {
  background: var(--color-background-mute);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.kv-list { display: flex; flex-direction: column; gap: 0.45rem; }
.kv { display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; }
.kv span:first-child { color: var(--color-text-soft); }
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
