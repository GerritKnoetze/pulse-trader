<script setup lang="ts">
import PulseChartHeader from './PulseChartHeader.vue'
import PulseChart from './PulseChart.vue'
import type { OHLCBar, BarMarker } from './PulseChart.vue'

defineProps<{
  symbol:      string
  label:       string
  title:       string
  timeVisible: boolean
  bars:        OHLCBar[]
  markers:     BarMarker[]
  isDemo:      boolean
}>()
</script>

<template>
  <div class="pulse-panel">
    <PulseChartHeader
      :symbol="symbol"
      :label="label"
      :title="title"
      :is-demo="isDemo"
    />
    <PulseChart
      class="panel-chart"
      :bars="bars"
      :markers="markers"
      :time-visible="timeVisible"
    />
  </div>
</template>

<style scoped>
.pulse-panel {
  display:        flex;
  flex-direction: column;
  overflow:       hidden;
  min-height:     0;
  background:     #131722;
}

.panel-chart {
  flex:       1;
  min-height: 0;
}
</style>
