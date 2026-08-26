<script setup lang="ts">
import { ref } from 'vue'
import { BellIcon, BellSlashIcon, TrashIcon, CheckIcon } from '@heroicons/vue/24/outline'
import { useScannerAlerts } from '~/composables/useScannerAlerts'
import type { ScannerAlert, AlertLevel } from '~/composables/useScannerAlerts'

defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const {
  visibleAlerts,
  unreadAlertCount,
  markAllRead,
  dismissAlert,
  dismissAll,
  clearDismissed,
  clearAll,
} = useScannerAlerts()

// Local filter
const showUnread = ref(false)

function filteredAlerts() {
  let list = visibleAlerts.value
  if (showUnread.value) list = list.filter(r => !r.read)
  return list
}

function levelLabel(r: ScannerAlert) { return r.level.toUpperCase() }
function levelIcon(r: ScannerAlert) {
  return r.level === 'success' ? '✓' : r.level === 'warn' ? '⚠' : r.level === 'error' ? '✕' : '•'
}

function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)   return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}
</script>

<template>
  <div class="side-drawer" :class="{ open }">
    <!-- Header -->
    <div class="drawer-header">
      <div class="drawer-header-left">
        <BellIcon class="drawer-header-icon" />
        <span class="drawer-title">Alerts</span>
        <span v-if="unreadAlertCount > 0" class="unread-chip">{{ unreadAlertCount }} new</span>
      </div>
      <button class="drawer-close-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- Filter bar -->
    <div class="filter-bar">
      <button
        class="unread-btn"
        :class="{ active: showUnread }"
        @click="showUnread = !showUnread"
      >Unread</button>
    </div>

    <!-- Bulk action bar -->
    <div class="action-bar">
      <button class="bulk-btn" :disabled="unreadAlertCount === 0" @click="markAllRead">
        <CheckIcon class="bulk-icon" /> Mark all read
      </button>
      <button class="bulk-btn" :disabled="visibleAlerts.length === 0" @click="dismissAll">
        <BellSlashIcon class="bulk-icon" /> Dismiss all
      </button>
      <button class="bulk-btn bulk-btn-danger" :disabled="visibleAlerts.length === 0" @click="clearAll">
        <TrashIcon class="bulk-icon" /> Clear all
      </button>
    </div>

    <div class="drawer-divider" />

    <!-- Alert list -->
    <div class="alerts-scroll">
      <div v-if="filteredAlerts().length === 0" class="alerts-empty">
        <BellSlashIcon class="empty-icon" />
        <span>No alerts yet.<br>Alerts will appear here when detected.</span>
      </div>

      <div
        v-for="rec in filteredAlerts()"
        :key="rec.id"
        class="alert-card"
        :class="{ unread: !rec.read }"
      >
        <!-- Unread dot -->
        <span class="unread-dot" :class="{ visible: !rec.read }" />

        <div class="alert-body">
          <!-- Row 1: level icon + title + age -->
          <div class="alert-row1">
            <span :class="['level-icon', `level-${rec.level}`]">{{ levelIcon(rec) }}</span>
            <span class="alert-title">{{ rec.title }}</span>
            <span class="alert-age">{{ relativeTime(rec.receivedAt) }}</span>
          </div>

          <div v-if="rec.message" class="alert-message">{{ rec.message }}</div>
        </div>

        <!-- Dismiss button -->
        <button class="dismiss-btn" title="Dismiss" @click.stop="dismissAlert(rec.id)">
          <TrashIcon class="dismiss-icon" />
        </button>
      </div>
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
  width: 300px;
  border-left-color: var(--color-border);
}

/* ── Header ── */
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.drawer-header-left {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.drawer-header-icon {
  width: 1rem;
  height: 1rem;
  color: var(--color-primary);
  flex-shrink: 0;
}
.drawer-title {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text);
}
.unread-chip {
  font-size: 0.6rem;
  font-weight: 800;
  background: #c87628;
  color: #fff;
  padding: 0.1rem 0.35rem;
  border-radius: 8px;
}
.drawer-close-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.1rem 0.25rem;
}
.drawer-close-btn:hover { color: var(--color-text); }

/* ── Filter bar ── */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.45rem 0.75rem;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.unread-btn {
  margin-left: auto;
  font-size: 0.65rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 3px;
  border: 1px solid var(--color-border);
  background: none;
  color: var(--color-text-soft);
  cursor: pointer;
  transition: all 0.15s;
}
.unread-btn.active, .unread-btn:hover {
  background: rgba(200, 118, 40, 0.2);
  border-color: #c87628;
  color: #e8983a;
}

/* ── Bulk actions ── */
.action-bar {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0 0.75rem 0.45rem;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.bulk-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.62rem;
  font-weight: 600;
  padding: 0.2rem 0.45rem;
  border-radius: 3px;
  border: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-soft);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.bulk-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text);
}
.bulk-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.bulk-btn-danger:hover:not(:disabled) {
  border-color: #c84040;
  color: #e06060;
  background: rgba(180, 40, 40, 0.12);
}
.bulk-icon { width: 0.7rem; height: 0.7rem; flex-shrink: 0; }

.drawer-divider {
  height: 1px;
  background: var(--color-border);
  flex-shrink: 0;
}

/* ── Alert list ── */
.alerts-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0.4rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 0;
}
.alerts-scroll::-webkit-scrollbar { width: 4px; }
.alerts-scroll::-webkit-scrollbar-track { background: transparent; }
.alerts-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
.alerts-scroll::-webkit-scrollbar-thumb:hover { background: #444; }

.alerts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 2rem 1rem;
  text-align: center;
  color: var(--color-text-soft);
  font-size: 0.72rem;
  line-height: 1.6;
}
.empty-icon { width: 1.8rem; height: 1.8rem; opacity: 0.35; }

/* ── Alert card ── */
.alert-card {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.03);
  transition: background 0.15s, border-color 0.15s;
  position: relative;
  overflow: hidden;
}
.alert-card.unread {
  border-left-color: #c87628;
  background: rgba(200, 118, 40, 0.07);
}
.alert-card:hover {
  background: rgba(255, 255, 255, 0.07);
}

/* Unread indicator dot */
.unread-dot {
  width: 3px;
  flex-shrink: 0;
  background: transparent;
  transition: background 0.15s;
}
.unread-dot.visible { background: #c87628; }

/* Body */
.alert-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  padding: 0.45rem 0.5rem;
  min-width: 0;
}

.alert-row1 {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.level-icon {
  font-size: 0.7rem;
  font-weight: 800;
  flex-shrink: 0;
}
.level-info    { color: #6ab0ff; }
.level-success { color: #5dde5d; }
.level-warn    { color: #f0c040; }
.level-error   { color: #e05050; }

.alert-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-text);
  flex: 1;
  min-width: 0;
}
.alert-age {
  font-size: 0.58rem;
  color: var(--color-text-soft);
  white-space: nowrap;
  flex-shrink: 0;
}

.alert-message {
  font-size: 0.68rem;
  line-height: 1.4;
  color: var(--color-text-soft);
  word-break: break-word;
}

/* Dismiss button */
.dismiss-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.4rem;
  background: none;
  border: none;
  border-left: 1px solid transparent;
  color: transparent;
  cursor: pointer;
  transition: all 0.15s;
}
.alert-card:hover .dismiss-btn {
  color: var(--color-text-soft);
  border-left-color: var(--color-border);
}
.dismiss-btn:hover {
  color: #e05050 !important;
  background: rgba(180, 40, 40, 0.1);
}
.dismiss-icon { width: 0.75rem; height: 0.75rem; }
</style>
