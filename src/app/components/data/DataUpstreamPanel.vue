<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  CloudArrowUpIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
} from '@heroicons/vue/24/outline'
import { useDataManager } from '~/composables/useDataManager'
import { useToast } from '~/composables/useToast'
import { formatNum } from '~/utils/data-format'
import DataStatCard from './DataStatCard.vue'

const {
  validateConnection, downloadHistory, fetchOverview,
} = useDataManager()
const toast = useToast()

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

const validating = ref(false)
const validation = ref<{ valid: boolean; message: string } | null>(null)

const downloading = ref(false)
const downloadResults = ref<Array<{ ticker: string; bars: number; error?: string }>>([])
const form = ref({
  tickers: 'AAPL,MSFT',
  timespan: 'day',
  multiplier: 1,
  from: isoDaysAgo(30),
  to: isoToday(),
})

const overview = ref<any>(null)

const timespanOptions = [
  { value: 'day', label: 'Day' },
  { value: 'minute', label: '1 Minute' },
  { value: '5min', label: '5 Minutes' },
  { value: '10s', label: '10 Seconds' },
  { value: 'hour', label: 'Hour' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

async function testConnection() {
  validating.value = true
  try {
    validation.value = await validateConnection()
  } catch (err) {
    validation.value = { valid: false, message: err instanceof Error ? err.message : 'Connection test failed' }
  } finally {
    validating.value = false
  }
}

const tickerList = computed(() => form.value.tickers.split(',').map(t => t.trim().toUpperCase()).filter(Boolean))

async function runDownload() {
  if (tickerList.value.length === 0) {
    toast.error('Enter at least one ticker')
    return
  }
  if (!form.value.from || !form.value.to) {
    toast.error('from and to dates are required')
    return
  }
  downloading.value = true
  downloadResults.value = []
  try {
    const res = await downloadHistory({
      tickers: tickerList.value,
      timespan: form.value.timespan,
      multiplier: Number(form.value.multiplier) || 1,
      from: form.value.from,
      to: form.value.to,
    })
    downloadResults.value = res.data
    const total = res.data.reduce((n, r) => n + r.bars, 0)
    toast.success(`Downloaded ${formatNum(total, 0)} bars across ${res.data.length} ticker(s)`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Download failed')
  } finally {
    downloading.value = false
  }
}

onMounted(async () => {
  try { overview.value = await fetchOverview() } catch { /* ignore */ }
})

async function refreshOverview() {
  try { overview.value = await fetchOverview() } catch { /* ignore */ }
}
</script>

<template>
  <div class="dm-panel">
    <div class="panel-toolbar">
      <h2 class="panel-title">L3 · Upstream data provider (Massive.com)</h2>
      <button class="btn btn-secondary btn-sm" @click="refreshOverview">
        <ArrowPathIcon class="btn-icon" />
        Refresh
      </button>
    </div>

    <!-- Connection test -->
    <section class="dm-section">
      <div class="section-header">
        <h3>Connection</h3>
      </div>
      <div class="conn-card">
        <button class="btn btn-primary" :disabled="validating" @click="testConnection">
          <CloudArrowUpIcon class="btn-icon" />
          {{ validating ? 'Testing…' : 'Test connection' }}
        </button>
        <div v-if="validation" class="conn-result" :class="validation.valid ? 'ok' : 'bad'">
          <CheckCircleIcon v-if="validation.valid" class="result-icon" />
          <XCircleIcon v-else class="result-icon" />
          <span>{{ validation.message }}</span>
        </div>
        <span v-else class="hint">Validates API key + base URL from Settings → Data Provider.</span>
      </div>
    </section>

    <!-- Upstream usage stats -->
    <template v-if="overview">
      <section class="dm-section">
        <div class="section-header"><h3>Session usage</h3></div>
        <div class="stat-grid">
          <DataStatCard label="REST fetches" :value="formatNum(overview.metrics.restFetches, 0)" :sub="`${formatNum(overview.metrics.restPageFetches, 0)} paginated pages`" />
          <DataStatCard label="Errors" :value="formatNum(overview.metrics.restErrors, 0)" accent="red" />
          <DataStatCard label="Rate-limited" :value="formatNum(overview.metrics.restRateLimited, 0)" accent="amber" />
          <DataStatCard label="Gaps detected" :value="formatNum(overview.metrics.restGaps, 0)" accent="red" />
        </div>
      </section>
    </template>

    <!-- Download historical data -->
    <section class="dm-section">
      <div class="section-header">
        <h3>Download historical data</h3>
        <span class="hint">Fetches from Massive.com, persists to SQLite (L2) and warms the cache (L1)</span>
      </div>
      <div class="sub-card">
        <div class="download-form">
          <label class="form-field">
            <span class="field-label">Tickers (comma-separated)</span>
            <input v-model="form.tickers" class="input-field" placeholder="AAPL,MSFT,TSLA" />
          </label>
          <label class="form-field">
            <span class="field-label">Timespan</span>
            <select v-model="form.timespan" class="input-field">
              <option v-for="o in timespanOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
          <label class="form-field">
            <span class="field-label">Multiplier</span>
            <input v-model.number="form.multiplier" type="number" min="1" class="input-field" />
          </label>
          <label class="form-field">
            <span class="field-label">From (YYYY-MM-DD)</span>
            <input v-model="form.from" type="date" class="input-field" />
          </label>
          <label class="form-field">
            <span class="field-label">To (YYYY-MM-DD)</span>
            <input v-model="form.to" type="date" class="input-field" />
          </label>
        </div>
        <div class="download-actions">
          <button class="btn btn-success" :disabled="downloading" @click="runDownload">
            <CloudArrowUpIcon class="btn-icon" :class="{ spin: downloading }" />
            {{ downloading ? 'Downloading…' : 'Download history' }}
          </button>
          <span class="hint">{{ tickerList.length }} ticker(s) · multiplier {{ form.multiplier }} × {{ form.timespan }}</span>
        </div>

        <div v-if="downloadResults.length > 0" class="results">
          <table class="data-table">
            <thead>
              <tr><th>Ticker</th><th class="num">Bars downloaded</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in downloadResults" :key="r.ticker">
                <td class="mono strong">{{ r.ticker }}</td>
                <td class="num mono">{{ formatNum(r.bars, 0) }}</td>
                <td>
                  <span v-if="r.error" class="sync-err">{{ r.error }}</span>
                  <span v-else class="sync-ok">ok</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="hint">Result persisted to SQLite and visible under the L2 · Database tab.</p>
        </div>
      </div>
    </section>
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
.conn-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1rem 1.25rem;
}
.conn-result { display: flex; align-items: center; gap: 0.45rem; font-size: 0.85rem; }
.conn-result.ok { color: #4ade80; }
.conn-result.bad { color: #f87171; }
.result-icon { width: 1.1rem; height: 1.1rem; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; }
.sub-card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1rem 1.25rem;
}
.download-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.9rem;
}
.form-field { display: flex; flex-direction: column; gap: 0.35rem; }
.field-label { font-size: 0.75rem; color: var(--color-text-soft); }
.download-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
}
.results { margin-top: 1.25rem; }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.data-table th { text-align: left; padding: 0.45rem 0.5rem; color: var(--color-text-soft); border-bottom: 1px solid var(--color-border); font-weight: 600; }
.data-table td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
.num { text-align: right; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.strong { font-weight: 600; }
.sync-err { color: #f87171; }
.sync-ok { color: #4ade80; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
