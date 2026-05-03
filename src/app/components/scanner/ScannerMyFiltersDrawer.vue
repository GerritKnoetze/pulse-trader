<script setup lang="ts">
import { computed } from 'vue'
import { TrashIcon } from '@heroicons/vue/24/outline'
import { useScanner, QUICK_FILTERS } from '~/composables/useScanner'
import { useGridFilterPresets } from '~/composables/useGridFilterPresets'
import { useGridFilters } from '~/composables/useGridFilters'

defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const { activeQuickFilter } = useScanner()
const { columnFilters } = useGridFilters()

const {
  savedPresets,
  newPresetName,
  confirmReplace,
  savePreset,
  commitSave,
  cancelReplace,
  applyPreset,
  deletePreset,
  clearAllFilters,
  activeColFilterCount,
} = useGridFilterPresets()

const activeQuickFilterLabel = computed(() =>
  activeQuickFilter.value
    ? (QUICK_FILTERS.find(f => f.id === activeQuickFilter.value)?.label ?? null)
    : null
)

const colFilterEntries = computed(() =>
  Object.entries(columnFilters.value)
    .filter(([, vals]) => Array.isArray(vals) && vals.length > 0)
    .map(([key, vals]) => ({ key, count: vals.length }))
)

const hasAnyActiveFilter = computed(() =>
  !!activeQuickFilter.value || colFilterEntries.value.length > 0
)
</script>

<template>
  <div class="side-drawer" :class="{ open }">
    <div class="drawer-header">
      <span class="drawer-title">My Filters</span>
      <button class="drawer-close-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- Active filter summary -->
    <div class="drawer-section active-summary">
      <div class="drawer-section-label">Currently Active</div>
      <div v-if="!hasAnyActiveFilter" class="drawer-empty">No active filters.</div>
      <div v-else class="active-tags">
        <span v-if="activeQuickFilterLabel" class="active-tag active-tag-quick">
          {{ activeQuickFilterLabel }}
        </span>
        <span
          v-for="entry in colFilterEntries"
          :key="entry.key"
          class="active-tag"
        >
          {{ entry.key }}
          <span class="active-tag-count">{{ entry.count }}</span>
        </span>
      </div>
    </div>

    <!-- Save current filters -->
    <div class="drawer-section">
      <div class="drawer-section-label">Save Current Filters</div>
      <div class="drawer-save-row">
        <input
          v-model="newPresetName"
          class="drawer-name-input"
          placeholder="Preset name..."
          maxlength="40"
          @keydown.enter="savePreset"
        />
        <button
          class="drawer-save-btn"
          :disabled="!newPresetName.trim() || !hasAnyActiveFilter"
          @click="savePreset"
        >Save</button>
      </div>
      <div v-if="!hasAnyActiveFilter" class="hint-text">Apply filters before saving.</div>
      <!-- Duplicate confirmation -->
      <div v-if="confirmReplace" class="preset-confirm">
        <span class="preset-confirm-msg">
          "<strong>{{ confirmReplace.name }}</strong>" already exists. Replace it?
        </span>
        <div class="preset-confirm-actions">
          <button class="preset-confirm-yes" @click="commitSave(confirmReplace!.name)">Replace</button>
          <button class="preset-confirm-no" @click="cancelReplace">Cancel</button>
        </div>
      </div>
    </div>

    <div class="drawer-divider" />

    <!-- Saved presets list -->
    <div class="drawer-section drawer-section-scroll">
      <div class="drawer-section-label">Saved Presets</div>
      <div v-if="savedPresets.length === 0" class="drawer-empty">No saved presets yet.</div>
      <div
        v-for="preset in savedPresets"
        :key="preset.id"
        class="preset-item"
      >
        <button class="preset-load-btn" @click="applyPreset(preset)">
          <span class="preset-name">{{ preset.name }}</span>
          <span class="preset-meta">
            <span v-if="preset.quickFilter" class="preset-meta-tag">QF</span>
            <span v-if="Object.keys(preset.columnFilters).length" class="preset-meta-tag">
              {{ Object.keys(preset.columnFilters).length }} col
            </span>
            <span class="preset-date">{{ preset.createdAt }}</span>
          </span>
        </button>
        <button class="preset-delete-btn" title="Delete" @click="deletePreset(preset.id)">
          <TrashIcon class="preset-delete-icon" />
        </button>
      </div>
    </div>

    <!-- Drawer footer -->
    <div class="drawer-footer">
      <button class="drawer-clear-btn" @click="clearAllFilters">✕ Clear All Filters</button>
    </div>
  </div>
</template>

<style scoped>
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

.drawer-section {
  padding: 0.65rem 0.75rem;
  flex-shrink: 0;
}

.drawer-section-scroll {
  flex: 1;
  overflow-y: auto;
  flex-shrink: 1;
}

.drawer-section-scroll::-webkit-scrollbar { width: 4px; }
.drawer-section-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

.drawer-section-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.5rem;
}

/* ── Active filter summary ───────────────────────────────── */
.active-summary {
  border-bottom: 1px solid var(--color-border);
}

.active-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.active-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: rgba(200, 118, 40, 0.12);
  border: 1px solid rgba(200, 118, 40, 0.3);
  color: #e8a84a;
  font-size: 0.73rem;
  padding: 0.15rem 0.45rem;
  border-radius: 10px;
  font-weight: 500;
}

.active-tag-quick {
  background: rgba(66, 184, 131, 0.12);
  border-color: rgba(66, 184, 131, 0.3);
  color: #42b883;
}

.active-tag-count {
  background: rgba(200, 118, 40, 0.25);
  color: #e8a84a;
  font-size: 0.65rem;
  font-weight: 700;
  border-radius: 8px;
  padding: 0 0.3rem;
  line-height: 1.4;
}

/* ── Save row ────────────────────────────────────────────── */
.drawer-save-row {
  display: flex;
  gap: 0.4rem;
}

.drawer-name-input {
  flex: 1;
  background: #111;
  border: 1px solid #333;
  border-radius: 4px;
  color: #ddd;
  font-size: 0.8rem;
  padding: 0.3rem 0.5rem;
  outline: none;
  min-width: 0;
}

.drawer-name-input:focus { border-color: #555; }

.drawer-save-btn {
  background: #c87628;
  border: none;
  color: #fff;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.3rem 0.65rem;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s;
  flex-shrink: 0;
}

.drawer-save-btn:hover:not(:disabled) { background: #d98830; }
.drawer-save-btn:disabled { opacity: 0.4; cursor: default; }

.hint-text {
  font-size: 0.72rem;
  color: #555;
  margin-top: 0.35rem;
}

/* ── Duplicate confirmation ──────────────────────────────── */
.preset-confirm {
  margin-top: 0.55rem;
  background: rgba(200, 118, 40, 0.1);
  border: 1px solid rgba(200, 118, 40, 0.35);
  border-radius: 5px;
  padding: 0.5rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.preset-confirm-msg {
  font-size: 0.78rem;
  color: #ccc;
  line-height: 1.4;
}

.preset-confirm-msg strong { color: #e8a84a; }

.preset-confirm-actions {
  display: flex;
  gap: 0.4rem;
}

.preset-confirm-yes {
  background: #c87628;
  border: none;
  color: #fff;
  font-size: 0.76rem;
  font-weight: 600;
  padding: 0.25rem 0.65rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s;
}
.preset-confirm-yes:hover { background: #d98830; }

.preset-confirm-no {
  background: none;
  border: 1px solid #3a3a3a;
  color: #888;
  font-size: 0.76rem;
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.1s;
}
.preset-confirm-no:hover { border-color: #555; color: #ccc; }

/* ── Divider ─────────────────────────────────────────────── */
.drawer-divider {
  height: 1px;
  background: var(--color-border);
  flex-shrink: 0;
}

/* ── Preset list items ───────────────────────────────────── */
.drawer-empty {
  font-size: 0.78rem;
  color: #555;
  padding: 0.3rem 0;
}

.preset-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  border-radius: 5px;
  margin-bottom: 0.3rem;
  border: 1px solid #2a2a2a;
  overflow: hidden;
  transition: border-color 0.12s;
}

.preset-item:hover { border-color: #3a3a3a; }

.preset-load-btn {
  flex: 1;
  background: none;
  border: none;
  text-align: left;
  padding: 0.45rem 0.6rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  transition: background 0.1s;
}

.preset-load-btn:hover { background: rgba(255,255,255,0.05); }

.preset-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: #ddd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-meta {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.preset-meta-tag {
  font-size: 0.64rem;
  font-weight: 700;
  background: rgba(200, 118, 40, 0.15);
  color: #c87628;
  border-radius: 3px;
  padding: 0.05rem 0.3rem;
  line-height: 1.5;
}

.preset-date {
  font-size: 0.68rem;
  color: #555;
}

.preset-delete-btn {
  background: none;
  border: none;
  color: #555;
  padding: 0 0.5rem;
  cursor: pointer;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.1s;
  flex-shrink: 0;
}

.preset-delete-btn:hover { color: #ef4444; }

.preset-delete-icon {
  width: 0.85rem;
  height: 0.85rem;
}

/* ── Footer ──────────────────────────────────────────────── */
.drawer-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--color-border);
  padding: 0.55rem 0.75rem;
}

.drawer-clear-btn {
  width: 100%;
  background: none;
  border: 1px solid #3a3a3a;
  color: #888;
  font-size: 0.78rem;
  padding: 0.35rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s;
  text-align: center;
}

.drawer-clear-btn:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.06);
}
</style>
