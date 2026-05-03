<script setup lang="ts">
import { computed } from 'vue'
import { useScanner } from '~/composables/useScanner'

const { totalCount, showingCount, universeCount, lastScan, isScanning, wsStatus } = useScanner()

const lastScanFormatted = computed(() => {
  if (!lastScan.value) return null
  try {
    return new Date(lastScan.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return null }
})

const wsLabel = computed(() => {
  switch (wsStatus.value) {
    case 'connected':    return 'Live'
    case 'connecting':   return 'Connecting…'
    case 'error':        return 'WS Error'
    default:             return 'Offline'
  }
})
</script>

<template>
  <div class="scanner-status-bar">
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

    <span class="ws-status" :class="`ws-status--${wsStatus}`">
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
}

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

