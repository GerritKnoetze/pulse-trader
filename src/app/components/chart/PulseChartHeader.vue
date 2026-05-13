<script setup lang="ts">
defineProps<{
  symbol:  string
  label:   string
  title:   string
  isDemo:  boolean
}>()
</script>

<template>
  <div class="panel-header">
    <div class="header-left">
      <span class="symbol">{{ symbol }}</span>
      <span class="tf-chip">{{ label }}</span>
      <span class="title">{{ title }}</span>
    </div>
    <span v-if="isDemo" class="demo-badge">DEMO</span>
  </div>
</template>

<style scoped>
.panel-header {
  display:         flex;
  align-items:     center;
  justify-content: space-between;
  padding:         0 10px;
  height:          28px;
  flex-shrink:     0;
  background:      #1a1a1a;
  border-bottom:   1px solid #2a2e39;
  font-family:     -apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif;
  user-select:     none;
}

.header-left {
  display:     flex;
  align-items: center;
  gap:         7px;
}

.symbol {
  color:          #d1d4dc;
  font-size:      12px;
  font-weight:    700;
  letter-spacing: 0.04em;
}

.tf-chip {
  background:     #c87028;
  color:          #fff;
  font-size:      10px;
  font-weight:    700;
  padding:        1px 6px;
  border-radius:  3px;
  letter-spacing: 0.03em;
}

.title {
  color:     #4b5563;
  font-size: 10px;
}

.demo-badge {
  color:          #4b5563;
  background:     #242424;
  font-size:      9px;
  font-weight:    700;
  padding:        1px 5px;
  border-radius:  3px;
  letter-spacing: 0.06em;
}
</style>
