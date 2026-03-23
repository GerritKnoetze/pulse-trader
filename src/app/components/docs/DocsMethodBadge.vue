<script setup lang="ts">
defineProps<{
  method: string
  size?: 'sm' | 'md'
}>()

const methodColors: Record<string, string> = {
  GET: '#42b883',
  POST: '#49a9ee',
  PUT: '#f5a623',
  DELETE: '#ff4d4f',
  PATCH: '#b37feb',
}
</script>

<template>
  <span
    class="method-badge"
    :class="[size || 'md']"
    :style="{ '--method-color': methodColors[method] || '#888' }"
  >
    {{ method }}
  </span>
</template>
