<script setup lang="ts">
import { useScanner } from '~/composables/useScanner'

const { totalCount, showingCount } = useScanner()
</script>

<template>
  <div class="scanner-status-bar">
    <span class="status-item">
      Total: <strong class="status-count">{{ totalCount }}</strong>
    </span>
    <span class="status-item">
      Showing: <strong class="status-count">{{ showingCount }}</strong>
    </span>
    <div class="status-spacer" />
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
}

.status-count {
  color: #c87628;
  font-weight: 700;
}

.status-spacer {
  flex: 1;
}
</style>
