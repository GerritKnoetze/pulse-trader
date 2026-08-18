<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  sub?: string
  accent?: 'primary' | 'green' | 'red' | 'blue' | 'amber'
}>()
</script>

<template>
  <div class="data-stat-card" :class="accent ? `accent-${accent}` : ''">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value">{{ value }}</div>
    <div v-if="sub" class="stat-sub">{{ sub }}</div>
  </div>
</template>

<style scoped>
.data-stat-card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 0.9rem 1.1rem;
  min-width: 0;
}
.stat-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-soft);
  opacity: 0.75;
  margin-bottom: 0.35rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stat-value {
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stat-sub {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  opacity: 0.7;
  margin-top: 0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.accent-primary .stat-value { color: var(--color-primary); }
.accent-green  .stat-value { color: #4ade80; }
.accent-red    .stat-value { color: #f87171; }
.accent-blue   .stat-value { color: #49a9ee; }
.accent-amber  .stat-value { color: #e5a00d; }
</style>
