<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ArrowPathIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { useDataManager } from '~/composables/useDataManager'
import { useAppLog } from '~/composables/useAppLog'
import { formatNum } from '~/utils/data-format'
import DataStatCard from './DataStatCard.vue'

const { fetchOverview, refreshTick } = useDataManager()
const { entries, connect, disconnect, clearLog } = useAppLog()

const overview = ref<any>(null)
const loading = ref(false)
const autoRefresh = ref(true)
let timer: ReturnType<typeof setInterval> | null = null

async function load() {
  if (loading.value) return
  loading.value = true
  try {
    overview.value = await fetchOverview()
  } catch { /* keep last */ }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  connect()
  void load()
  timer = setInterval(() => {
    if (autoRefresh.value) void load()
  }, 5000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  disconnect()
})

watch(refreshTick, () => { void load() })

const metrics = computed(() => overview.value?.metrics ?? null)

const metricItems = computed<Array<{ key: string; label: string; value: string; accent?: 'primary' | 'green' | 'red' | 'blue' | 'amber' }>>(() => {
  const v = metrics.value
  if (!v) return []
  return [
    { key: 'candleL1HitRate', label: 'L1 hit rate', value: `${v.candleL1HitRate}%`, accent: 'green' as const },
    { key: 'sqliteReads', label: 'SQLite reads', value: formatNum(v.sqliteReads, 0) },
    { key: 'sqliteWrites', label: 'SQLite writes', value: formatNum(v.sqliteWrites, 0) },
    { key: 'restFetches', label: 'REST fetches', value: formatNum(v.restFetches, 0) },
    { key: 'restErrors', label: 'REST errors', value: formatNum(v.restErrors, 0), accent: 'red' as const },
    { key: 'restRateLimited', label: 'Rate limited', value: formatNum(v.restRateLimited, 0), accent: 'amber' as const },
    { key: 'restGaps', label: 'Gaps', value: formatNum(v.restGaps, 0), accent: 'red' as const },
    { key: 'wsTicks', label: 'WS ticks', value: formatNum(v.wsTicks, 0), accent: 'blue' as const },
    { key: 'wsReconnects', label: 'WS reconnects', value: formatNum(v.wsReconnects, 0) },
    { key: 'snapshotFetches', label: 'Snapshot fetches', value: formatNum(v.snapshotFetches, 0) },
    { key: 'snapshotServedStale', label: 'Snapshot served stale', value: formatNum(v.snapshotServedStale, 0), accent: 'amber' as const },
    { key: 'scans', label: 'Scans', value: formatNum(v.scans, 0) },
  ]
})

const logLevelClass = (level: string) => `log-${level}`
</script>

<template>
  <div class="dm-panel">
    <div class="panel-toolbar">
      <h2 class="panel-title">Live activity</h2>
      <label class="auto-refresh">
        <input v-model="autoRefresh" type="checkbox" />
        Auto-refresh 5s
      </label>
      <button class="btn btn-secondary btn-sm" @click="load">
        <ArrowPathIcon class="btn-icon" />
        Refresh
      </button>
    </div>

    <template v-if="metrics">
      <section class="dm-section">
        <div class="section-header"><h3>Data-layer counters</h3></div>
        <div class="stat-grid">
          <DataStatCard v-for="item in metricItems" :key="item.key" :label="item.label" :value="item.value" :accent="item.accent" />
        </div>
        <div class="mono-counters">
          <span class="hint">Raw counters:</span>
          <code class="mono raw-line">{{ JSON.stringify(metrics) }}</code>
        </div>
      </section>

      <section class="dm-section">
        <div class="section-header">
          <h3>App log ({{ entries.length }})</h3>
          <div class="log-actions">
            <span class="live-chip"><span class="chip-dot" /> live SSE</span>
            <button class="btn btn-secondary btn-sm" @click="clearLog">
              <TrashIcon class="btn-icon" />
              Clear
            </button>
          </div>
        </div>
        <div v-if="entries.length === 0" class="muted-center">No log entries yet — activity appears here in real time.</div>
        <div v-else class="log-box">
          <div v-for="e in entries.slice().reverse()" :key="e.id" class="log-line" :class="logLevelClass(e.level)">
            <span class="log-ts">{{ new Date(e.ts).toLocaleTimeString() }}</span>
            <span class="log-level">{{ e.level }}</span>
            <span class="log-msg">{{ e.msg }}</span>
          </div>
        </div>
      </section>
    </template>

    <div v-else class="dm-loading">Loading…</div>
  </div>
</template>

<style scoped>
.dm-panel { display: flex; flex-direction: column; gap: 1.25rem; }
.panel-toolbar { display: flex; align-items: center; gap: 0.75rem; }
.panel-title { margin: 0; font-size: 1rem; font-weight: 600; flex: 1; }
.dm-section { display: flex; flex-direction: column; gap: 0.75rem; }
.section-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.section-header h3 { margin: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-soft); }
.hint { font-size: 0.72rem; color: var(--color-text-soft); opacity: 0.7; }
.dm-loading { color: var(--color-text-soft); padding: 2rem; text-align: center; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.75rem; }
.mono-counters { display: flex; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap; }
.raw-line { font-size: 0.7rem; color: var(--color-text-soft); background: var(--color-background-mute); padding: 0.4rem 0.6rem; border-radius: var(--radius-sm); overflow-x: auto; max-width: 100%; }
.log-actions { display: flex; align-items: center; gap: 0.6rem; }
.log-box {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  max-height: 55vh;
  overflow-y: auto;
  padding: 0.5rem 0;
  font-size: 0.78rem;
}
.log-line {
  display: flex;
  gap: 0.6rem;
  padding: 0.3rem 0.9rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.log-line:hover { background: var(--color-background-mute); }
.log-ts { color: var(--color-text-soft); opacity: 0.6; white-space: nowrap; }
.log-level { text-transform: uppercase; font-size: 0.68rem; font-weight: 700; width: 3.2rem; flex-shrink: 0; padding-top: 0.08rem; }
.log-info .log-level { color: #49a9ee; }
.log-warn .log-level { color: #e5a00d; }
.log-error .log-level { color: #f87171; }
.log-msg { color: var(--color-text); word-break: break-word; }
.muted-center { color: var(--color-text-soft); opacity: 0.7; text-align: center; padding: 1.25rem; }
.auto-refresh { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: var(--color-text-soft); }
.live-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.7rem;
  color: #4ade80;
  background: rgba(74, 222, 128, 0.1);
  border: 1px solid rgba(74, 222, 128, 0.3);
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
}
.chip-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse-dot 1.6s ease-in-out infinite; }
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }
</style>
