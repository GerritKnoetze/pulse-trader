<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import InfoTooltip from '~/components/shared/InfoTooltip.vue'

const currentTime = ref(new Date())
let animationFrameId: number | null = null
let lastUpdate = 0

const updateTime = (timestamp: number) => {
  if (timestamp - lastUpdate >= 1000) {
    currentTime.value = new Date()
    lastUpdate = timestamp
  }
  animationFrameId = requestAnimationFrame(updateTime)
}

// --- DST detection for US Eastern Time ---
const isDSTActive = (date: Date): boolean => {
  const year = date.getFullYear()
  const march = new Date(year, 2, 1)
  const marchSecondSunday = new Date(year, 2, 1 + ((7 - march.getDay()) % 7) + 7)
  marchSecondSunday.setHours(2, 0, 0, 0)
  const november = new Date(year, 10, 1)
  const novFirstSunday = new Date(year, 10, 1 + ((7 - november.getDay()) % 7))
  novFirstSunday.setHours(2, 0, 0, 0)
  return date >= marchSecondSunday && date < novFirstSunday
}

const easternOffset = computed(() => (isDSTActive(currentTime.value) ? -4 : -5))
const tzLabel = computed(() => (isDSTActive(currentTime.value) ? 'EDT' : 'EST'))

// Helper: get time adjusted to a fixed UTC offset
const timeInOffset = (offset: number) => {
  const t = currentTime.value
  const utc = t.getTime() + t.getTimezoneOffset() * 60000
  return new Date(utc + offset * 3600000)
}

const localOffset = 2 // UTC+2
const localDate = computed(() => timeInOffset(localOffset))
const edtDate = computed(() => timeInOffset(easternOffset.value))

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]

const formattedDate = computed(() => {
  const d = localDate.value
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
})

const fmt12 = (d: Date): string => {
  let h = d.getHours()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s} ${ampm}`
}

const localTime = computed(() => fmt12(localDate.value))
const edtTime = computed(() => fmt12(edtDate.value))

// --- Market session logic (ET-based) ---
const edtTotalMinutes = computed(() => {
  const d = edtDate.value
  return d.getHours() * 60 + d.getMinutes()
})

const edtDay = computed(() => edtDate.value.getDay())

const sessionLabel = computed(() => {
  if (edtDay.value === 0 || edtDay.value === 6) return 'MARKET CLOSED'
  const m = edtTotalMinutes.value
  if (m >= 240 && m < 570) return 'PRE-MARKET'
  if (m >= 570 && m < 960) return 'MARKET OPEN'
  if (m >= 960 && m < 1200) return 'AFTER-HOURS'
  return 'MARKET CLOSED'
})

const sessionClass = computed(() => {
  if (edtDay.value === 0 || edtDay.value === 6) return 'session-closed'
  const m = edtTotalMinutes.value
  if (m >= 240 && m < 570) return 'session-premarket'
  if (m >= 570 && m < 960) return 'session-open'
  if (m >= 960 && m < 1200) return 'session-afterhours'
  return 'session-closed'
})

// Timeline: 24h bar — each hour = 100/24 %
const pct = (h: number) => (h / 24) * 100

// Hourly tick positions (skip 0 to avoid tick at the left edge)
const hours = Array.from({ length: 23 }, (_, i) => i + 1)

// Current indicator position on the bar (based on ET time)
const indicatorPosition = computed(() => {
  const d = edtDate.value
  const frac = (d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600) / 24
  return Math.min(Math.max(frac * 100, 0), 100)
})

onMounted(() => {
  currentTime.value = new Date()
  lastUpdate = performance.now()
  animationFrameId = requestAnimationFrame(updateTime)
})

onUnmounted(() => {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
})
</script>

<template>
  <InfoTooltip title="Market Sessions & Times" width="700px">
    <template #trigger>
      <div class="market-status-bar">
        <div class="msb-top-row">
          <span class="msb-date">{{ formattedDate }}</span>
          <span class="msb-sep">•</span>
          <span class="msb-time">{{ localTime }} <span class="msb-tz">LOCAL</span></span>
          <span class="msb-sep">•</span>
          <span class="msb-time">{{ edtTime }} <span class="msb-tz">{{ tzLabel }}</span></span>
        </div>
        <div class="msb-bottom-row">
          <span class="msb-session-label" :class="sessionClass">{{ sessionLabel }}</span>
          <div class="msb-timeline">
            <div class="msb-bar">
              <div class="msb-seg msb-seg--closed-early" />
              <div class="msb-seg msb-seg--premarket" />
              <div class="msb-seg msb-seg--regular" />
              <div class="msb-seg msb-seg--afterhours" />
              <div class="msb-seg msb-seg--closed-late" />
              <div
                v-for="h in hours"
                :key="h"
                class="msb-tick"
                :style="{ left: pct(h) + '%' }"
              />
              <div class="msb-indicator" :style="{ left: indicatorPosition + '%' }" />
            </div>
            <div class="msb-labels">
              <span class="msb-lbl" style="left: 0%">6am</span>
              <span class="msb-lbl" :style="{ left: pct(4) + '%' }">10am</span>
              <span class="msb-lbl" :style="{ left: pct(9.5) + '%' }">3:30pm</span>
              <span class="msb-lbl" :style="{ left: pct(16) + '%' }">10pm</span>
              <span class="msb-lbl" :style="{ left: pct(20) + '%' }">2am</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #content>
      <div class="msb-tooltip-content">
        <p class="msb-tooltip-desc">
          US Stock Market trading hours — current session:
          <strong :class="sessionClass">{{ sessionLabel }}</strong>
        </p>

        <table class="msb-session-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Local (UTC+2)</th>
              <th>{{ tzLabel }} (UTC{{ easternOffset >= 0 ? '+' : '' }}{{ easternOffset }})</th>
              <th>UTC</th>
            </tr>
          </thead>
          <tbody>
            <tr :class="{ 'msb-row-active': sessionClass === 'session-premarket' }">
              <td class="msb-session-cell">
                <span class="msb-dot msb-dot--premarket" />
                <span>Pre-Market</span>
              </td>
              <td>11:00 AM – 4:30 PM</td>
              <td>4:00 AM – 9:30 AM</td>
              <td>8:00 AM – 1:30 PM</td>
            </tr>
            <tr :class="{ 'msb-row-active': sessionClass === 'session-open' }">
              <td class="msb-session-cell">
                <span class="msb-dot msb-dot--regular" />
                <span>Regular Hours</span>
              </td>
              <td>4:30 PM – 11:00 PM</td>
              <td>9:30 AM – 4:00 PM</td>
              <td>1:30 PM – 8:00 PM</td>
            </tr>
            <tr :class="{ 'msb-row-active': sessionClass === 'session-afterhours' }">
              <td class="msb-session-cell">
                <span class="msb-dot msb-dot--afterhours" />
                <span>After-Hours</span>
              </td>
              <td>11:00 PM – 3:00 AM</td>
              <td>4:00 PM – 8:00 PM</td>
              <td>8:00 PM – 12:00 AM</td>
            </tr>
            <tr :class="{ 'msb-row-active': sessionClass === 'session-closed' }">
              <td class="msb-session-cell">
                <span class="msb-dot msb-dot--closed" />
                <span>Closed</span>
              </td>
              <td>3:00 AM – 11:00 AM</td>
              <td>8:00 PM – 4:00 AM</td>
              <td>12:00 AM – 8:00 AM</td>
            </tr>
          </tbody>
        </table>

        <p class="msb-tooltip-note">* Weekend trading is closed. Times adjust automatically for DST.</p>
      </div>
    </template>
  </InfoTooltip>
</template>

<style scoped>
/* ── Trigger widget ───────────────────────────────────────── */
.market-status-bar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  user-select: none;
  min-width: 700px;
  cursor: default;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  transition: background var(--transition-speed) var(--transition-timing);
}

.market-status-bar:hover {
  background: var(--color-background-mute);
}

/* Top row */
.msb-top-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.msb-date {
  text-transform: uppercase;
  color: var(--color-text-soft);
  opacity: 0.5;
}

.msb-sep {
  color: var(--color-text-soft);
  opacity: 0.4;
}

.msb-time {
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}

.msb-tz {
  color: var(--color-text-soft);
  font-size: 10px;
  font-weight: 500;
  opacity: 0.5;
}

/* Bottom row */
.msb-bottom-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.msb-session-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  white-space: nowrap;
  text-transform: uppercase;
}

.session-closed    { color: #94a3b8; }
.session-premarket { color: #f59e0b; }
.session-open      { color: #10b981; }
.session-afterhours{ color: #a78bfa; }

/* Timeline */
.msb-timeline {
  flex: 1;
  position: relative;
  min-width: 0;
}

.msb-bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  position: relative;
  background: #1e293b;
}

/*
 * Segments proportional to 24 h (EDT):
 * Closed early  0–4am   = 4 h
 * Pre-market    4–9:30  = 5.5 h
 * Regular       9:30–16 = 6.5 h
 * After-hours   16–20   = 4 h
 * Closed late   20–24   = 4 h
 */
.msb-seg { height: 100%; }
.msb-seg--closed-early  { flex: 4;   background: #334155; }
.msb-seg--premarket     { flex: 5.5; background: #b45309; }
.msb-seg--regular       { flex: 6.5; background: #047857; }
.msb-seg--afterhours    { flex: 4;   background: #6d28d9; }
.msb-seg--closed-late   { flex: 4;   background: #334155; }

.msb-tick {
  position: absolute;
  top: 0;
  width: 1px;
  height: 100%;
  background: rgba(0, 0, 0, 0.25);
  pointer-events: none;
  z-index: 1;
}

.msb-indicator {
  position: absolute;
  top: -2px;
  width: 2px;
  height: 10px;
  background: #fff;
  border-radius: 1px;
  transform: translateX(-1px);
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.6);
  z-index: 2;
}

.msb-labels {
  position: relative;
  height: 12px;
  margin-top: 1px;
}

.msb-lbl {
  position: absolute;
  font-size: 10px;
  color: var(--color-text-soft);
  opacity: 0.5;
  white-space: nowrap;
  font-weight: 500;
}

/* ── Tooltip content ──────────────────────────────────────── */
.msb-tooltip-content {
  color: var(--color-text);
}

.msb-tooltip-desc {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.msb-session-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.msb-session-table thead th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  font-weight: 600;
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 2px solid rgba(255, 255, 255, 0.2);
}

.msb-session-table tbody tr {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.msb-session-table tbody tr:last-child {
  border-bottom: none;
}

.msb-session-table tbody td {
  padding: 0.625rem 0.75rem;
  color: var(--color-text);
  font-weight: 500;
}

.msb-row-active {
  background: rgba(255, 255, 255, 0.06);
  outline: 1px solid rgba(255, 255, 255, 0.12);
}

.msb-session-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.msb-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.msb-dot--premarket  { background: #f59e0b; box-shadow: 0 0 8px rgba(245, 158, 11, 0.5); }
.msb-dot--regular    { background: #10b981; box-shadow: 0 0 8px rgba(16, 185, 129, 0.5); }
.msb-dot--afterhours { background: #a78bfa; box-shadow: 0 0 8px rgba(167, 139, 250, 0.5); }
.msb-dot--closed     { background: #94a3b8; box-shadow: 0 0 8px rgba(148, 163, 184, 0.3); }

.msb-tooltip-note {
  margin: 1rem 0 0;
  font-size: 0.8rem;
  color: var(--color-text-soft);
  font-style: italic;
  opacity: 0.7;
}
</style>
