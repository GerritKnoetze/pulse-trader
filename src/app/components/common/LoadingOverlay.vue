<script setup lang="ts">
defineProps<{
  label?: string
}>()
</script>

<template>
  <Transition name="loading-fade">
    <div class="loading-overlay" role="status" :aria-label="label ?? 'Loading'">
      <span class="loading-spinner" aria-hidden="true" />
      <span class="loading-label">{{ label ?? 'Loading…' }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.85rem;
  background: rgba(10, 10, 12, 0.72);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.loading-spinner {
  display: inline-block;
  width: 2rem;
  height: 2rem;
  border: 2.5px solid rgba(200, 118, 40, 0.18);
  border-top-color: #c87628;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }

.loading-label {
  font-size: 0.84rem;
  color: #aaa;
  letter-spacing: 0.02em;
}

/* Fade transition */
.loading-fade-enter-active,
.loading-fade-leave-active { transition: opacity 0.2s ease; }
.loading-fade-enter-from,
.loading-fade-leave-to     { opacity: 0; }
</style>
