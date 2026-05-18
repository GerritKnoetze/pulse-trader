<script setup lang="ts">
import { computed } from 'vue'
import { useScanner } from '~/composables/useScanner'

const props = defineProps<{ logOpen?: boolean }>()
const emit  = defineEmits<{ (e: 'toggle-log'): void }>()

const { totalCount, showingCount, universeCount, lastScan, isScanning, wsStatus, serverWsStatus } = useScanner()

const lastScanFormatted = computed(() => {
  if (!lastScan.value) return null
  try {
    return new Date(lastScan.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return null }
})

const wsLabel = computed(() => {
  // If the EventSource itself isn't connected, show that first
  if (wsStatus.value === 'connecting') return 'Connecting…'
  if (wsStatus.value === 'error')      return 'SSE Error'
  if (wsStatus.value !== 'connected')  return 'Offline'
  // EventSource is up — reflect the actual server-side WS relay status
  switch (serverWsStatus.value) {
    case 'connected':      return 'Live'
    case 'connecting':
    case 'authenticating': return 'WS Connecting…'
    case 'error':          return 'WS Error'
    default:               return 'WS Offline'
  }
})

// CSS class for the dot — use serverWsStatus when EventSource is connected
const wsDotClass = computed(() => {
  if (wsStatus.value !== 'connected') return `ws-status--${wsStatus.value}`
  return `ws-status--${serverWsStatus.value}`
})
</script>

<template>
  <div class="scanner-status-bar" :class="{ 'log-open': logOpen }" role="button" tabindex="0" title="Click to toggle console log" @click="emit('toggle-log')" @keydown.enter.space.prevent="emit('toggle-log')">
    <span v-if="isScanning" class="status-item scanning-pulse">Scanning…</span>
    <template v-else>
      <span class="status-item">
        Universe: <strong class="status-count">{{ universeCount.toLocaleString() }}</strong>
      </span>
      <span class="status-item">
        Matched: <strong class="status-count">{{ totalCount.toLocaleString() }}</strong>
      </span>
      <span class="status-item">
        Showing: <strong class="status-count">{{ showingCount.toLocaleString() }}</strong>
      </span>
      <span v-if="lastScanFormatted" class="status-item">
        Last scan: <strong class="status-count">{{ lastScanFormatted }}</strong>
      </span>
    </template>

    <div class="status-spacer" />

    <div class="log-toggle-notch">
      <span class="notch-dot" />
      <span class="notch-dot" />
      <span class="notch-dot" />
    </div>

    <span class="ws-status" :class="wsDotClass">
      <span class="ws-dot" />
      {{ wsLabel }}
    </span>
  </div>
</template>

<style scoped>
.scanner-status-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.3rem 0.75rem;
  background: var(--color-background-soft);
  border-top: 1px solid var(--color-border);
  font-size: 0.8rem;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
  position: relative;
}
.scanner-status-bar:hover { background: var(--color-background-mute, #1e1e1e); }
.scanner-status-bar.log-open { border-bottom: 1px solid var(--color-border); }

.status-item {
  color: var(--color-text-soft);
  white-space: nowrap;
}

.status-count {
  color: #c87628;
  font-weight: 700;
}

.scanning-pulse {
  color: #c87628;
  animation: pulse-text 1s ease-in-out infinite;
}
@keyframes pulse-text { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.status-spacer { flex: 1; }

.log-toggle-notch {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  width: 3rem;
  height: 8px;
  border-radius: 0 0 8px 8px;
  background: #333;
  pointer-events: none;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  padding-bottom: 2px;
}

.notch-dot {
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #666;
  flex-shrink: 0;
}

.ws-status {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}
.ws-status--connected    { color: #4ade80; }
.ws-status--connecting   { color: #facc15; }
.ws-status--error        { color: #f87171; }
.ws-status--disconnected { color: #555; }

.ws-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.ws-status--connecting .ws-dot {
  animation: pulse-dot 1s ease-in-out infinite;
}
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>

