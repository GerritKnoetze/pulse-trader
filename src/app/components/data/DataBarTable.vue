<script setup lang="ts">
import { ref } from 'vue'
import { PencilSquareIcon, TrashIcon, PlusIcon, ArrowDownTrayIcon } from '@heroicons/vue/24/outline'
import { useDataManager, type DataBarRow } from '~/composables/useDataManager'
import { useToast } from '~/composables/useToast'
import { formatTs, formatNum } from '~/utils/data-format'
import DataBarModal from './DataBarModal.vue'

const props = defineProps<{
  ticker: string
  timespan: string
  source: 'cache' | 'db'
  rows: DataBarRow[]
}>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const { removeRow } = useDataManager()
const toast = useToast()

const modalOpen = ref(false)
const editingRow = ref<DataBarRow | null>(null)
const deletingId = ref<string | null>(null)
const busy = ref(false)

function openAdd() {
  editingRow.value = null
  modalOpen.value = true
}

function openEdit(row: DataBarRow) {
  editingRow.value = row
  modalOpen.value = true
}

async function onSaved() {
  emit('changed')
}

async function del(row: DataBarRow) {
  deletingId.value = row.id
  busy.value = true
  try {
    const res = await removeRow({
      id: row.id ?? undefined,
      ticker: row.ticker,
      timespan: row.timespan,
      timestamp: row.timestamp,
    })
    toast.success(`${res.data.deleted} bar(s) deleted`)
    emit('changed')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to delete bar')
  } finally {
    deletingId.value = null
    busy.value = false
  }
}

function exportCsv() {
  const header = 'timestamp_et,open,high,low,close,volume,transactions'
  const lines = props.rows.map(r =>
    [formatTs(r.timestamp), r.open, r.high, r.low, r.close, r.volume, r.transactions ?? ''].join(','),
  )
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.ticker}_${props.timespan}_${props.source}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="bar-table-wrap">
    <div class="bar-table-toolbar">
      <span class="bar-count">{{ rows.length }} bars · source: <strong>{{ source }}</strong></span>
      <div class="bar-actions">
        <button class="btn btn-secondary btn-sm" title="Export CSV" @click="exportCsv">
          <ArrowDownTrayIcon class="btn-icon" />
          CSV
        </button>
        <button class="btn btn-primary btn-sm" @click="openAdd">
          <PlusIcon class="btn-icon" />
          Add bar
        </button>
      </div>
    </div>

    <div v-if="rows.length === 0" class="empty-state">
      No bars in {{ source }} layer for {{ ticker }} · {{ timespan }}.
    </div>

    <div v-else class="bar-table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp (ET)</th>
            <th class="num">Open</th>
            <th class="num">High</th>
            <th class="num">Low</th>
            <th class="num">Close</th>
            <th class="num">Volume</th>
            <th class="num">Txn</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id ?? row.timestamp">
            <td class="mono">{{ formatTs(row.timestamp) }}</td>
            <td class="num mono">{{ formatNum(row.open) }}</td>
            <td class="num mono">{{ formatNum(row.high) }}</td>
            <td class="num mono">{{ formatNum(row.low) }}</td>
            <td class="num mono">{{ formatNum(row.close) }}</td>
            <td class="num mono">{{ formatNum(row.volume, 0) }}</td>
            <td class="num mono">{{ row.transactions != null ? formatNum(row.transactions, 0) : '—' }}</td>
            <td class="actions-col">
              <div class="row-actions">
                <button class="row-btn" title="Edit" :disabled="busy" @click="openEdit(row)">
                  <PencilSquareIcon class="btn-icon" />
                </button>
                <button class="row-btn danger" title="Delete" :disabled="busy" @click="del(row)">
                  <TrashIcon class="btn-icon" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <DataBarModal
      :open="modalOpen"
      :row="editingRow"
      :default-ticker="ticker"
      :default-timespan="timespan"
      @close="modalOpen = false"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.bar-table-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-height: 0;
}
.bar-table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.bar-count { font-size: 0.8rem; color: var(--color-text-soft); }
.bar-actions { display: flex; gap: 0.5rem; }
.btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }
.empty-state {
  padding: 1.5rem;
  text-align: center;
  color: var(--color-text-soft);
  opacity: 0.8;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
}
.bar-table-scroll {
  overflow: auto;
  max-height: 46vh;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}
.data-table th {
  position: sticky;
  top: 0;
  background: var(--color-background-mute);
  text-align: left;
  padding: 0.5rem 0.6rem;
  font-weight: 600;
  color: var(--color-text-soft);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
  z-index: 1;
}
.data-table td {
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}
.data-table tbody tr:hover { background: var(--color-background-mute); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
.num { text-align: right; }
.actions-col { width: 90px; text-align: center; }
.row-actions { display: flex; gap: 0.3rem; justify-content: center; }
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
</style>
