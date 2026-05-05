<script setup lang="ts">
const props = defineProps<{
  title: string
  width?: string
}>()

const visible = ref(false)
</script>

<template>
  <div
    class="info-tooltip-wrapper"
    @mouseenter="visible = true"
    @mouseleave="visible = false"
  >
    <slot name="trigger" />

    <Transition name="tooltip-fade">
      <div
        v-if="visible"
        class="info-tooltip-panel"
        :style="props.width ? { width: props.width } : {}"
      >
        <div class="info-tooltip-header">{{ props.title }}</div>
        <div class="info-tooltip-body">
          <slot name="content" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.info-tooltip-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.info-tooltip-panel {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 260px;
  max-width: 90vw;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  z-index: calc(var(--z-header) + 10);
  overflow: hidden;
}

.info-tooltip-header {
  padding: 0.6rem 1rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--color-text-soft);
  background: var(--color-background-mute);
  border-bottom: 1px solid var(--color-border);
}

.info-tooltip-body {
  padding: 1rem;
}

/* Transition */
.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Bridge: invisible overlay that prevents mouseout in the gap */
.info-tooltip-panel::before {
  content: '';
  position: absolute;
  top: -8px;
  left: 0;
  right: 0;
  height: 8px;
}
</style>
