<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { useDataManager, type DataBarRow } from '~/composables/useDataManager'
import { useToast } from '~/composables/useToast'
import { tsToInput, inputToTs, formatTs } from '~/utils/data-format'

const props = defineProps<{
  open: boolean
  row: DataBarRow | null
  defaultTicker?: string
  defaultTimespan?: string
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

const { saveRow } = useDataManager()
const toast = useToast()
const saving = ref(false)

const form = reactive({
  ticker: '',
  timespan: '',
  timestampInput: '',
  open: 0,
  high: 0,
  low: 0,
  close: 0,
  volume: 0,
  transactions: '',
})

const isEdit = ref(false)

function reset() {
  const row = props.row
  isEdit.value = !!row
  form.ticker = row?.ticker ?? props.defaultTicker ?? ''
  form.timespan = row?.timespan ?? props.defaultTimespan ?? ''
  const ts = row?.timestamp ?? Date.now()
  form.timestampInput = tsToInput(ts)
  form.open = row?.open ?? 0
  form.high = row?.high ?? 0
  form.low = row?.low ?? 0
  form.close = row?.close ?? 0
  form.volume = row?.volume ?? 0
  form.transactions = row?.transactions != null ? String(row.transactions) : ''
}

watch(() => props.open, (v) => { if (v) reset() })

async function submit() {
  const timestamp = inputToTs(form.timestampInput)
  if (!timestamp) {
    toast.error('Enter a valid timestamp')
    return
  }
  saving.value = true
  try {
    await saveRow({
      id: isEdit.value && props.row?.id ? props.row.id : undefined,
      ticker: form.ticker.trim().toUpperCase(),
      timespan: form.timespan.trim(),
      timestamp,
      open: Number(form.open),
      high: Number(form.high),
      low: Number(form.low),
      close: Number(form.close),
      volume: Number(form.volume),
      transactions: form.transactions === '' ? null : Number(form.transactions),
    })
    toast.success(isEdit.value ? 'Bar updated' : 'Bar saved')
    emit('saved')
    emit('close')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to save bar')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div class="data-modal">
        <div class="modal-header">
          <h3>{{ isEdit ? `Edit ${row?.ticker ?? ''} ${row?.timespan ?? ''} bar` : 'Add bar' }}</h3>
          <button class="modal-close" title="Close" @click="emit('close')">
            <XMarkIcon class="btn-icon" />
          </button>
        </div>

        <div class="modal-body">
          <div class="form-grid">
            <label class="form-field">
              <span class="field-label">Ticker</span>
              <input v-model="form.ticker" class="input-field" placeholder="AAPL" :disabled="isEdit" />
            </label>
            <label class="form-field">
              <span class="field-label">Timespan</span>
              <input v-model="form.timespan" class="input-field" placeholder="day / minute / 5min / 10s" :disabled="isEdit" />
            </label>
            <label class="form-field form-field-wide">
              <span class="field-label">Timestamp (ET)</span>
              <input v-model="form.timestampInput" type="datetime-local" class="input-field" :disabled="isEdit && !!row?.id" />
              <span v-if="isEdit && !!row?.id" class="field-hint">Timestamp is fixed for existing rows (natural key).</span>
              <span v-else-if="!isEdit" class="field-hint">Resolves to {{ formatTs(inputToTs(form.timestampInput) || Date.now()) }}</span>
            </label>
            <label class="form-field">
              <span class="field-label">Open</span>
              <input v-model="form.open" type="number" step="any" class="input-field" />
            </label>
            <label class="form-field">
              <span class="field-label">High</span>
              <input v-model="form.high" type="number" step="any" class="input-field" />
            </label>
            <label class="form-field">
              <span class="field-label">Low</span>
              <input v-model="form.low" type="number" step="any" class="input-field" />
            </label>
            <label class="form-field">
              <span class="field-label">Close</span>
              <input v-model="form.close" type="number" step="any" class="input-field" />
            </label>
            <label class="form-field">
              <span class="field-label">Volume</span>
              <input v-model="form.volume" type="number" step="any" class="input-field" />
            </label>
            <label class="form-field">
              <span class="field-label">Transactions</span>
              <input v-model="form.transactions" type="number" step="any" class="input-field" placeholder="optional" />
            </label>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" @click="emit('close')">Cancel</button>
          <button class="btn btn-primary" :disabled="saving" @click="submit">
            {{ saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add bar' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.data-modal {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  width: min(560px, calc(100vw - 2rem));
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}
.modal-header h3 { margin: 0; font-size: 1rem; }
.modal-close {
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
}
.modal-close:hover { color: var(--color-text); }
.modal-body { padding: 1.25rem; overflow-y: auto; }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--color-border);
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.9rem;
}
.form-field { display: flex; flex-direction: column; gap: 0.35rem; }
.form-field-wide { grid-column: 1 / -1; }
.field-label { font-size: 0.75rem; color: var(--color-text-soft); }
.field-hint { font-size: 0.7rem; color: var(--color-text-soft); opacity: 0.7; }
</style>
