<script setup lang="ts">
import { TrashIcon } from '@heroicons/vue/24/outline'
import { useGridLayouts } from '~/composables/useGridLayouts'

defineProps<{ open: boolean }>()
defineEmits<{ close: []; reset: [] }>()

const {
  savedLayouts,
  newLayoutName,
  confirmReplace,
  saveLayout,
  commitSave,
  cancelReplace,
  applyLayout,
  deleteLayout,
} = useGridLayouts()
</script>

<template>
  <div class="side-drawer" :class="{ open }">
    <div class="drawer-header">
      <span class="drawer-title">Layouts</span>
      <button class="drawer-close-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- Save current layout -->
    <div class="drawer-section">
      <div class="drawer-section-label">Save Current Layout</div>
      <div class="drawer-save-row">
        <input
          v-model="newLayoutName"
          class="drawer-name-input"
          placeholder="Layout name..."
          maxlength="40"
          @keydown.enter="saveLayout"
        />
        <button
          class="drawer-save-btn"
          :disabled="!newLayoutName.trim()"
          @click="saveLayout"
        >Save</button>
      </div>
      <!-- Duplicate confirmation -->
      <div v-if="confirmReplace" class="layout-confirm">
        <span class="layout-confirm-msg">
          "<strong>{{ confirmReplace.name }}</strong>" already exists. Replace it?
        </span>
        <div class="layout-confirm-actions">
          <button class="layout-confirm-yes" @click="commitSave(confirmReplace!.name)">Replace</button>
          <button class="layout-confirm-no" @click="cancelReplace">Cancel</button>
        </div>
      </div>
    </div>

    <div class="drawer-divider" />

    <!-- Saved layouts list -->
    <div class="drawer-section drawer-section-scroll">
      <div class="drawer-section-label">Saved Layouts</div>
      <div v-if="savedLayouts.length === 0" class="drawer-empty">No saved layouts yet.</div>
      <div
        v-for="layout in savedLayouts"
        :key="layout.id"
        class="layout-item"
      >
        <button class="layout-load-btn" @click="applyLayout(layout)">
          <span class="layout-name">{{ layout.name }}</span>
          <span class="layout-date">{{ layout.createdAt }}</span>
        </button>
          <button class="layout-delete-btn" title="Delete" @click="deleteLayout(layout.id)">
            <TrashIcon class="layout-delete-icon" />
          </button>
      </div>
    </div>

    <!-- Drawer footer -->
    <div class="drawer-footer">
      <button class="drawer-reset-btn" @click="$emit('reset')">↺ Reset to Default</button>
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

.layout-confirm {
  margin-top: 0.55rem;
  background: rgba(200, 118, 40, 0.1);
  border: 1px solid rgba(200, 118, 40, 0.35);
  border-radius: 5px;
  padding: 0.5rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.layout-confirm-msg {
  font-size: 0.78rem;
  color: #ccc;
  line-height: 1.4;
}

.layout-confirm-msg strong { color: #e8a84a; }

.layout-confirm-actions {
  display: flex;
  gap: 0.4rem;
}

.layout-confirm-yes {
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
.layout-confirm-yes:hover { background: #d98830; }

.layout-confirm-no {
  background: none;
  border: 1px solid #3a3a3a;
  color: #888;
  font-size: 0.76rem;
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.1s;
}
.layout-confirm-no:hover { border-color: #555; color: #ccc; }

.drawer-divider {
  height: 1px;
  background: var(--color-border);
  flex-shrink: 0;
}

.drawer-empty {
  font-size: 0.78rem;
  color: #555;
  padding: 0.3rem 0;
}

.layout-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  border-radius: 5px;
  margin-bottom: 0.3rem;
  border: 1px solid #2a2a2a;
  overflow: hidden;
  transition: border-color 0.12s;
}

.layout-item:hover { border-color: #3a3a3a; }

.layout-load-btn {
  flex: 1;
  background: none;
  border: none;
  text-align: left;
  padding: 0.45rem 0.6rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  transition: background 0.1s;
}

.layout-load-btn:hover { background: rgba(255,255,255,0.05); }

.layout-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: #ddd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-date {
  font-size: 0.68rem;
  color: #555;
}

.layout-delete-btn {
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

.layout-delete-btn:hover { color: #ef4444; }

.layout-delete-icon {
  width: 0.85rem;
  height: 0.85rem;
}

.drawer-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--color-border);
  padding: 0.55rem 0.75rem;
}

.drawer-reset-btn {
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

.drawer-reset-btn:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.06);
}
</style>
