<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { ArrowPathIcon } from '@heroicons/vue/24/outline'
import { useDataManager } from '~/composables/useDataManager'
import { formatBytes, formatNum, formatCompact, formatTs, formatDuration } from '~/utils/data-format'
import DataStatCard from './DataStatCard.vue'

const { fetchOverview, navigate, refreshTick } = useDataManager()

const overview = ref<any>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const lastUpdated = ref<number | null>(null)

let timer: ReturnType<typeof setInterval> | null = null

async function load() {
  if (loading.value) return
  loading.value = true
  try {
    overview.value = await fetchOverview()
    lastUpdated.value = Date.now()
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load overview'
  } finally {
    loading.value = false
  }
}

function drill(tab: 'cache' | 'db') {
  navigate(tab)
}

onMounted(() => {
  void load()
  timer = setInterval(() => { void load() }, 5000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

watch(refreshTick, () => { void load() })

const wsLabel = (s: string) => {
  if (!s || s === 'disconnected') return 'Offline'
  return s[0]!.toUpperCase() + s.slice(1)
}
</script>

<template>
  <div class="dm-panel overview-panel">
    <div v-if="error" class="dm-error">
      {{ error }}
      <button class="btn btn-secondary btn-sm" @click="load">Retry</button>
    </div>

    <template v-if="overview">
      <div class="panel-toolbar">
        <h2 class="panel-title">Application data — at a glance</h2>
        <span class="live-chip" :class="{ live: true }">
          <span class="chip-dot" />
          Auto-refresh 5s
        </span>
        <button class="btn btn-secondary btn-sm" @click="load">
          <ArrowPathIcon class="btn-icon" />
          Refresh
        </button>
      </div>

      <!-- ── L2: Database ─────────────────────────────────────────────── -->
      <section class="dm-section">
        <div class="section-header">
          <h3>L2 · SQLite Database</h3>
          <button class="link-btn" @click="drill('db')">Open Database →</button>
        </div>
        <div class="stat-grid">
          <DataStatCard label="DB file" :value="formatBytes(overview.db.fileSizeBytes)" :sub="overview.db.path" accent="primary" />
          <DataStatCard label="Total bars" :value="formatCompact(overview.db.totalBars)" :sub="`${overview.db.totalSyncStates} sync-state rows`" accent="green" />
          <DataStatCard label="Tables" :value="overview.db.tables.length" :sub="overview.db.tables.map(t => t.name).join(', ') || '—'" />
          <DataStatCard label="Settings rows" :value="overview.db.settingsCount" :sub="overview.db.connected ? 'connected' : 'disconnected'" accent="blue" />
        </div>
      </section>

      <!-- ── L1: Cache ─────────────────────────────────────────────────── -->
      <section class="dm-section">
        <div class="section-header">
          <h3>L1 · In-Memory Cache</h3>
          <button class="link-btn" @click="drill('cache')">Open Cache →</button>
        </div>
        <div class="stat-grid">
          <DataStatCard label="Candle cache entries" :value="overview.l1.candleEntries" :sub="`${formatCompact(overview.l1.candleBars)} bars in memory`" accent="amber" />
          <DataStatCard label="Snapshot cache" :value="formatCompact(overview.l1.snapshot?.tickerCount ?? 0)" :sub="overview.l1.snapshot?.fetchedAt ? `fetched ${formatDuration(Date.now() - overview.l1.snapshot.fetchedAt)} ago` : 'cold'" />
          <DataStatCard label="Scanner row cache" :value="overview.l1.rowCache" :sub="`${overview.l1.intraday} live intraday states`" accent="green" />
          <DataStatCard label="Watched symbols" :value="overview.l1.watched.length" :sub="`10s buckets: ${overview.l1.tenSec}`" accent="blue" />
        </div>
        <div class="breakdown-grid">
          <div class="sub-card">
            <h4>Candle cache by timespan</h4>
            <table class="data-table">
              <thead>
                <tr><th>Timespan</th><th class="num">Bars</th></tr>
              </thead>
              <tbody>
                <tr v-for="(count, tf) in overview.l1.candleByTimespan" :key="tf">
                  <td class="mono">{{ tf }}</td>
                  <td class="num mono">{{ formatNum(count, 0) }}</td>
                </tr>
                <tr v-if="Object.keys(overview.l1.candleByTimespan).length === 0">
                  <td colspan="2" class="muted">Empty cache</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="sub-card">
            <h4>Live WebSocket</h4>
            <div class="kv-list">
              <div class="kv"><span>Status</span><span class="ws-badge" :class="`ws-${overview.l1.wsStatus}`">{{ wsLabel(overview.l1.wsStatus) }}</span></div>
              <div class="kv"><span>Subscriptions</span><span class="mono">{{ overview.l1.wsSubscriptions }}</span></div>
              <div class="kv"><span>SSE clients</span><span class="mono">{{ overview.l1.sseClients }}</span></div>
              <div class="kv"><span>Last scan</span><span class="mono">{{ overview.lastScan ? new Date(overview.lastScan).toLocaleTimeString() : '—' }}</span></div>
            </div>
          </div>
        </div>
      </section>

      <!-- ── L3: Upstream ──────────────────────────────────────────────── -->
      <section class="dm-section">
        <div class="section-header">
          <h3>L3 · Upstream (Massive.com)</h3>
          <button class="link-btn" @click="navigate('upstream')">Open Upstream →</button>
        </div>
        <div class="stat-grid">
          <DataStatCard label="REST fetches" :value="formatNum(overview.metrics.restFetches, 0)" :sub="`${formatNum(overview.metrics.restPageFetches, 0)} paginated pages`" />
          <DataStatCard label="REST errors" :value="formatNum(overview.metrics.restErrors, 0)" accent="red" />
          <DataStatCard label="Rate limited" :value="formatNum(overview.metrics.restRateLimited, 0)" accent="amber" />
          <DataStatCard label="Detected gaps" :value="formatNum(overview.metrics.restGaps, 0)" accent="red" />
        </div>
      </section>

      <!-- ── Sync state ────────────────────────────────────────────────── -->
      <section v-if="overview.syncStates.length > 0" class="dm-section">
        <div class="section-header">
          <h3>Sync state ({{ overview.syncStates.length }})</h3>
          <button class="link-btn" @click="drill('db')">Manage →</button>
        </div>
        <div class="sub-card">
          <table class="data-table">
            <thead>
              <tr>
                <th>Ticker</th><th>Timespan</th><th>Latest bar</th><th>Last sync</th><th>Gap</th><th>Error</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in overview.syncStates.slice(0, 30)" :key="`${s.Ticker}:${s.Timespan}`">
                <td class="mono">{{ s.Ticker }}</td>
                <td class="mono">{{ s.Timespan }}</td>
                <td class="mono">{{ s.LatestTimestamp ? formatTs(s.LatestTimestamp) : '—' }}</td>
                <td class="mono">{{ s.LastSyncAt ? new Date(s.LastSyncAt).toLocaleTimeString() : '—' }}</td>
                <td class="mono">{{ s.GapStart && s.GapEnd ? `${formatTs(s.GapStart)} → ${formatTs(s.GapEnd)}` : '—' }}</td>
                <td class="mono" :class="{ 'err-text': s.SyncError }">{{ s.SyncError || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else class="dm-section">
        <div class="sub-card muted-center">No sync-state rows yet — run a scan or download history to populate.</div>
      </section>

      <footer class="dm-footer">
        <span>Updated {{ lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—' }}</span>
      </footer>
    </template>

    <div v-else class="dm-loading">Loading overview…</div>
  </div>
</template>

<style scoped>
.dm-panel { display: flex; flex-direction: column; gap: 1.25rem; }
.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
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
.live-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  color: #4ade80;
  background: rgba(74, 222, 128, 0.1);
  border: 1px solid rgba(74, 222, 128, 0.3);
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
}
.chip-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse-dot 1.6s ease-in-out infinite; }
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.dm-section { display: flex; flex-direction: column; gap: 0.75rem; }
.section-header { display: flex; align-items: center; justify-content: space-between; }
.section-header h3 { margin: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-soft); }
.link-btn { background: none; border: none; color: var(--color-primary); font-size: 0.78rem; cursor: pointer; }
.link-btn:hover { text-decoration: underline; }

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
}
.breakdown-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
@media (max-width: 900px) { .breakdown-grid { grid-template-columns: 1fr; } }
.sub-card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 0.9rem 1rem;
}
.sub-card h4 { margin: 0 0 0.6rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-soft); }
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}
.data-table th {
  text-align: left;
  padding: 0.4rem 0.5rem;
  color: var(--color-text-soft);
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
  white-space: nowrap;
}
.data-table td { padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
.data-table tbody tr:hover { background: var(--color-background-mute); }
.num { text-align: right; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
.muted { color: var(--color-text-soft); opacity: 0.7; }
.err-text { color: var(--color-danger); }
.muted-center { color: var(--color-text-soft); opacity: 0.7; text-align: center; padding: 1rem; }

.kv-list { display: flex; flex-direction: column; gap: 0.5rem; }
.kv { display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; }
.kv span:first-child { color: var(--color-text-soft); }
.ws-badge { font-weight: 600; }
.ws-connected { color: #4ade80; }
.ws-error { color: #f87171; }
.ws-disconnected { color: var(--color-text-soft); opacity: 0.7; }
.ws-connecting, .ws-authenticating { color: #facc15; }

.dm-footer { color: var(--color-text-soft); opacity: 0.6; font-size: 0.75rem; padding-top: 0.5rem; }
.btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }
</style>
