<script setup lang="ts">
import { ref } from 'vue'
import { BellIcon, BellSlashIcon, TrashIcon, CheckIcon } from '@heroicons/vue/24/outline'
import { useStratSetups } from '~/composables/useStratSetups'
import type { SetupAlertRecord, SetupQuality } from '~/composables/useStratSetups'
import ScannerSetupChecklist from '~/components/scanner/ScannerSetupChecklist.vue'

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
  selectSetup,
  selectedSetup,
  cancelPriceAlert,
} = useStratSetups()

// Local filter — null = all, or quality grade
const gradeFilter  = ref<SetupQuality | null>(null)
const showUnread   = ref(false)

const GRADES: SetupQuality[] = ['A+', 'A', 'B', 'C']

function filteredAlerts() {
  let list = visibleAlerts.value
  if (showUnread.value) list = list.filter(r => !r.read)
  if (gradeFilter.value) list = list.filter(r => r.setup.quality === gradeFilter.value)
  return list
}

function toggleGrade(g: SetupQuality) {
  gradeFilter.value = gradeFilter.value === g ? null : g
}

function qualityClass(q: string) { return `quality-${q.replace('+', 'plus')}` }
function dirLabel(r: SetupAlertRecord) { return r.setup.direction === 'long' ? '▲' : '▼' }
function dirClass(r: SetupAlertRecord) { return r.setup.direction === 'long' ? 'long' : 'short' }

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)   return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function openChecklist(rec: SetupAlertRecord) {
  // Mark as read when opened
  rec.read = true
  selectSetup(rec.setup)
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

    <!-- Checklist detail view -->
    <template v-if="selectedSetup">
      <ScannerSetupChecklist :setup="selectedSetup" @back="selectSetup(null)" />
    </template>

    <!-- Alert list view -->
    <template v-else>
      <!-- Filter bar -->
      <div class="filter-bar">
        <button
          v-for="grade in GRADES"
          :key="grade"
          class="grade-btn"
          :class="[qualityClass(grade), { active: gradeFilter === grade }]"
          @click="toggleGrade(grade)"
        >{{ grade }}</button>
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
          <span>No alerts yet.<br>A+/A setups will appear here when detected.</span>
        </div>

        <div
          v-for="rec in filteredAlerts()"
          :key="rec.id"
          class="alert-card"
          :class="{ unread: !rec.read }"
        >
          <!-- Unread dot -->
          <span class="unread-dot" :class="{ visible: !rec.read }" />

          <!-- Card body (clickable) -->
          <button class="alert-body" @click="openChecklist(rec)">
            <!-- Row 1: symbol + quality + direction + age -->
            <div class="alert-row1">
              <span class="alert-symbol">{{ rec.setup.symbol }}</span>
              <span :class="['quality-badge', qualityClass(rec.setup.quality)]">{{ rec.setup.quality }}</span>
              <span :class="['dir-badge', dirClass(rec)]">{{ dirLabel(rec) }} {{ rec.setup.direction.toUpperCase() }}</span>
              <span class="alert-age">{{ relativeTime(rec.receivedAt) }}</span>
            </div>

            <!-- Row 2: combo + source badge -->
            <div class="alert-combo">
              <span>{{ rec.setup.signalTf }}: {{ rec.setup.combo }}</span>
              <span :class="['source-badge', rec.source === 'user' ? 'source-user' : 'source-auto']">
                {{ rec.source === 'user' ? 'USER' : 'AUTO' }}
              </span>
            </div>

            <!-- Row 3: key levels -->
            <div class="alert-levels">
              <span class="lvl entry">E ${{ fmt(rec.setup.entryPrice) }}</span>
              <span class="lvl stop">S ${{ fmt(rec.setup.stop) }}</span>
              <span v-if="rec.setup.targets[0]" class="lvl target">T1 ${{ fmt(rec.setup.targets[0]) }}</span>
              <span class="lvl rr">R:R {{ rec.setup.rr }}</span>
            </div>

            <!-- Row 4: inForce / ftfc / TF continuity status -->
            <div class="alert-status">
              <span v-if="rec.setup.inForce" class="status-chip in-force">⚡ In Force</span>
              <span v-if="rec.setup.ftfc"    class="status-chip ftfc">FTFC</span>
              <span
                class="status-chip"
                :class="{
                  'cont-full':     rec.setup.tfContinuity === 'full',
                  'cont-partial':  rec.setup.tfContinuity === 'partial',
                  'cont-conflict': rec.setup.tfContinuity === 'conflicted',
                }"
              >
                {{ rec.setup.tfContinuity === 'full' ? '✓ Full TF' : rec.setup.tfContinuity === 'partial' ? '~ Partial TF' : '✗ TF conflict' }}
              </span>
            </div>

            <!-- Row 5 (user alerts): price alert status -->
            <div v-if="rec.source === 'user'" class="alert-price-status">
              <span
                class="price-status-chip"
                :class="{
                  'ps-armed':     rec.priceAlertStatus === 'armed',
                  'ps-triggered': rec.priceAlertStatus === 'triggered',
                  'ps-cancelled': rec.priceAlertStatus === 'cancelled',
                }"
              >
                <template v-if="rec.priceAlertStatus === 'armed'">🎯 Watching entry</template>
                <template v-else-if="rec.priceAlertStatus === 'triggered'">✓ Triggered</template>
                <template v-else>✗ Cancelled</template>
              </span>
            </div>
          </button>

          <!-- Cancel button (user alerts, armed only) -->
          <button
            v-if="rec.source === 'user' && rec.priceAlertStatus === 'armed'"
            class="cancel-btn"
            title="Cancel price alert"
            @click.stop="cancelPriceAlert(rec.id)"
          >✕</button>

          <!-- Dismiss button -->
          <button class="dismiss-btn" title="Dismiss" @click.stop="dismissAlert(rec.id)">
            <TrashIcon class="dismiss-icon" />
          </button>
        </div>
      </div>
    </template>
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

.grade-btn {
  font-size: 0.65rem;
  font-weight: 800;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  border: 1px solid transparent;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s;
}
.grade-btn.active, .grade-btn:hover { opacity: 1; }
.grade-btn.quality-Aplus  { background: #2a5c2a; color: #6dde6d; border-color: #4a9c4a; }
.grade-btn.quality-A      { background: #1e4a1e; color: #4fc34f; border-color: #3a7a3a; }
.grade-btn.quality-B      { background: #3a3a1a; color: #c8c840; border-color: #6a6a30; }
.grade-btn.quality-C      { background: #3a1a1a; color: #c84040; border-color: #6a3030; }

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
  overflow-y: scroll;
  padding: 0.4rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 0;
}

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

/* Body button */
.alert-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  padding: 0.45rem 0.5rem;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.alert-row1 {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.alert-symbol {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--color-text);
}
.quality-badge {
  font-size: 0.62rem;
  font-weight: 800;
  padding: 0.08rem 0.25rem;
  border-radius: 3px;
  flex-shrink: 0;
}
.quality-Aplus  { background: #2a5c2a; color: #6dde6d; }
.quality-A      { background: #1e4a1e; color: #4fc34f; }
.quality-B      { background: #3a3a1a; color: #c8c840; }
.quality-C      { background: #3a1a1a; color: #c84040; }

.dir-badge {
  font-size: 0.63rem;
  font-weight: 700;
  padding: 0.08rem 0.28rem;
  border-radius: 3px;
  flex-shrink: 0;
}
.dir-badge.long  { color: #4fc34f; background: rgba(40, 120, 40, 0.2); }
.dir-badge.short { color: #e05050; background: rgba(180, 40, 40, 0.2); }

.alert-age {
  margin-left: auto;
  font-size: 0.58rem;
  color: var(--color-text-soft);
  white-space: nowrap;
  flex-shrink: 0;
}

.alert-combo {
  font-size: 0.68rem;
  color: var(--color-text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

/* Source badge */
.source-badge {
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 0.06rem 0.22rem;
  border-radius: 3px;
  flex-shrink: 0;
}
.source-auto { background: rgba(80, 100, 160, 0.2); color: #8090d0; }
.source-user { background: rgba(200, 118, 40, 0.2); color: #c87628; }

/* Price alert status row */
.alert-price-status {
  margin-top: 0.25rem;
}
.price-status-chip {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.08rem 0.28rem;
  border-radius: 3px;
}
.ps-armed     { background: rgba(200, 118, 40, 0.15); color: #c87628; }
.ps-triggered { background: rgba(40, 160, 80, 0.15);  color: #40c060; }
.ps-cancelled { background: rgba(100, 100, 100, 0.12); color: #888; }

.alert-levels {
  display: flex;
  gap: 0.45rem;
  flex-wrap: wrap;
}
.lvl { font-size: 0.65rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.lvl.entry  { color: #6ab0ff; }
.lvl.stop   { color: #ff8080; }
.lvl.target { color: #70d080; }
.lvl.rr     { color: var(--color-text-soft); }

.alert-status {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.status-chip {
  font-size: 0.58rem;
  font-weight: 700;
  padding: 0.08rem 0.28rem;
  border-radius: 3px;
}
.in-force    { background: rgba(240, 192, 64, 0.15); color: #f0c040; }
.ftfc        { background: rgba(100, 100, 220, 0.15); color: #9090e8; }
.cont-full     { background: rgba(40, 140, 40, 0.15); color: #5dde5d; }
.cont-partial  { background: rgba(180, 180, 40, 0.12); color: #c8c840; }
.cont-conflict { background: rgba(180, 40, 40, 0.12); color: #e05050; }

/* Cancel button (user armed alerts) */
.cancel-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.4rem;
  background: none;
  border: none;
  border-left: 1px solid var(--color-border);
  color: #c87628;
  cursor: pointer;
  font-size: 0.65rem;
  font-weight: 700;
  transition: all 0.15s;
}
.cancel-btn:hover {
  color: #e8982c;
  background: rgba(200, 118, 40, 0.12);
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
