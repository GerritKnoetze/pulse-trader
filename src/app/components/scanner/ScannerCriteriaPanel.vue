<script setup lang="ts">
import { computed } from 'vue'
import { AdjustmentsHorizontalIcon } from '@heroicons/vue/24/outline'
import { useScanCriteria } from '~/composables/useScanCriteria'
import { useScanner } from '~/composables/useScanner'

defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const { criteria, activeCount, updateCriteria, resetCriteria } = useScanCriteria()
const { runScan, isScanning } = useScanner()

const form = {
  minPrice:         computed({ get: () => criteria.value.minPrice         ?? '', set: (v) => updateCriteria({ minPrice:         v === '' ? undefined : Number(v) }) }),
  maxPrice:         computed({ get: () => criteria.value.maxPrice         ?? '', set: (v) => updateCriteria({ maxPrice:         v === '' ? undefined : Number(v) }) }),
  minChangePercent: computed({ get: () => criteria.value.minChangePercent ?? '', set: (v) => updateCriteria({ minChangePercent: v === '' ? undefined : Number(v) }) }),
  maxChangePercent: computed({ get: () => criteria.value.maxChangePercent ?? '', set: (v) => updateCriteria({ maxChangePercent: v === '' ? undefined : Number(v) }) }),
  minVolume:        computed({ get: () => criteria.value.minVolume        ?? '', set: (v) => updateCriteria({ minVolume:        v === '' ? undefined : Number(v) }) }),
  minRvol:          computed({ get: () => criteria.value.minRvol          ?? '', set: (v) => updateCriteria({ minRvol:          v === '' ? undefined : Number(v) }) }),
}

function handleReset() {
  resetCriteria()
  runScan(false)
}
</script>

<template>
  <div class="side-drawer" :class="{ open }">
    <div class="drawer-header">
      <div class="drawer-header-left">
        <AdjustmentsHorizontalIcon class="drawer-header-icon" />
        <span class="drawer-title">Scan Criteria</span>
      </div>
      <button class="drawer-close-btn" @click="$emit('close')">✕</button>
    </div>

    <div class="criteria-body drawer-section-scroll">
      <!-- Price range -->
      <div class="criteria-group">
        <div class="criteria-group-label">Price ($)</div>
        <div class="criteria-row">
          <div class="criteria-field">
            <label class="field-label">Min</label>
            <input v-model="form.minPrice.value" type="number" min="0" step="0.01" class="criteria-input" placeholder="e.g. 1" />
          </div>
          <span class="range-sep">—</span>
          <div class="criteria-field">
            <label class="field-label">Max</label>
            <input v-model="form.maxPrice.value" type="number" min="0" step="0.01" class="criteria-input" placeholder="e.g. 50" />
          </div>
        </div>
      </div>

      <!-- Change % range -->
      <div class="criteria-group">
        <div class="criteria-group-label">Change %</div>
        <div class="criteria-row">
          <div class="criteria-field">
            <label class="field-label">Min</label>
            <input v-model="form.minChangePercent.value" type="number" step="0.1" class="criteria-input" placeholder="e.g. 5" />
          </div>
          <span class="range-sep">—</span>
          <div class="criteria-field">
            <label class="field-label">Max</label>
            <input v-model="form.maxChangePercent.value" type="number" step="0.1" class="criteria-input" placeholder="e.g. 100" />
          </div>
        </div>
      </div>

      <!-- Volume -->
      <div class="criteria-group">
        <div class="criteria-group-label">Volume (Min)</div>
        <div class="criteria-row single">
          <div class="criteria-field wide">
            <input v-model="form.minVolume.value" type="number" min="0" step="100000" class="criteria-input" placeholder="e.g. 500000" />
          </div>
        </div>
      </div>

      <!-- Relative Volume -->
      <div class="criteria-group">
        <div class="criteria-group-label">Relative Volume (Min ×)</div>
        <div class="criteria-row single">
          <div class="criteria-field wide">
            <input v-model="form.minRvol.value" type="number" min="0" step="0.1" class="criteria-input" placeholder="e.g. 1.5" />
          </div>
        </div>
      </div>
    </div>

    <div class="criteria-footer">
      <button class="btn-reset" :disabled="activeCount === 0" @click="handleReset">Reset</button>
      <button class="btn-scan" :disabled="isScanning" @click="runScan(false)">
        <span v-if="isScanning" class="scan-spinner" />
        {{ isScanning ? 'Scanning…' : 'Scan' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── Drawer shell (shared pattern) ───────────────────────── */
.side-drawer {
  width: 0;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #161616;
  border-left: 1px solid transparent;
  transition: width 0.22s ease, border-color 0.22s ease;
}

.side-drawer.open {
  width: 260px;
  border-left-color: var(--color-border);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.drawer-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: #ddd;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.drawer-close-btn {
  background: none;
  border: none;
  color: #666;
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.15rem 0.3rem;
  border-radius: 3px;
  transition: color 0.1s;
  line-height: 1;
}
.drawer-close-btn:hover { color: #ccc; }

.drawer-header-icon {
  width: 14px;
  height: 14px;
  color: #c87628;
  flex-shrink: 0;
}

.drawer-header-left {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.drawer-section-scroll {
  flex: 1;
  overflow-y: auto;
}
.drawer-section-scroll::-webkit-scrollbar { width: 4px; }
.drawer-section-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

.criteria-body {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
  flex: 1;
  padding: 0.5rem 0;
}

.criteria-group {
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.criteria-group-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-soft);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.4rem;
}

.criteria-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.criteria-row.single {
  display: block;
}

.criteria-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.criteria-field.wide {
  width: 100%;
}

.field-label {
  font-size: 0.66rem;
  color: var(--color-text-soft);
}

.range-sep {
  color: var(--color-text-soft);
  font-size: 0.8rem;
  padding-top: 1rem;
  flex-shrink: 0;
}

.criteria-input {
  width: 100%;
  padding: 0.28rem 0.45rem;
  font-size: 0.78rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-text);
  outline: none;
  box-sizing: border-box;
}
.criteria-input:focus { border-color: #c87628; }
.criteria-input::placeholder { color: var(--color-text-mute, #555); }

/* Hide number spinners */
.criteria-input::-webkit-outer-spin-button,
.criteria-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.criteria-input[type=number] { -moz-appearance: textfield; }

.criteria-footer {
  display: flex;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.btn-reset {
  flex: 0 0 auto;
  padding: 0.35rem 0.75rem;
  font-size: 0.75rem;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-text-soft);
  cursor: pointer;
}
.btn-reset:hover:not(:disabled) { border-color: var(--color-text); color: var(--color-text); }
.btn-reset:disabled { opacity: 0.4; cursor: default; }

.btn-scan {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.35rem 0;
  font-size: 0.78rem;
  font-weight: 600;
  background: #c87628;
  border: none;
  border-radius: 3px;
  color: #fff;
  cursor: pointer;
  letter-spacing: 0.02em;
}
.btn-scan:hover:not(:disabled) { background: #d98a3a; }
.btn-scan:disabled { opacity: 0.5; cursor: default; }

.scan-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
