<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ChartOverlays } from './PulseChart.vue'
import { OVERLAY_META, type OverlayId } from '~/utils/indicators'

const props = defineProps<{
  symbol:  string
  label:   string
  isDemo:  boolean
  overlays: ChartOverlays
  maximized?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-overlay', id: OverlayId): void
  (e: 'maximize'): void
}>()

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

function copySymbol() {
  navigator.clipboard.writeText(props.symbol)
    .then(() => {
      copied.value = true
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => { copied.value = false }, 1200)
    })
    .catch(() => { /* clipboard unavailable */ })
}

// ── Indicator overlay multi-select dropdown ─────────────────────────────────
const menuOpen = ref(false)
const enabledCount = computed(() => OVERLAY_META.filter(o => props.overlays[o.id]).length)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') menuOpen.value = false
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="panel-header">
    <div class="header-left">
      <span
        class="symbol"
        :class="{ copied }"
        :title="`Copy ${symbol}`"
        @click="copySymbol"
      >{{ copied ? '✓ Copied' : symbol }}</span>
      <span class="tf-chip">{{ label }}</span>
      <span class="header-divider"></span>
      <div class="indicator-menu" @click.stop>
        <button
          class="indicator-trigger"
          :class="{ open: menuOpen }"
          title="Indicator overlays"
          @click="menuOpen = !menuOpen"
        >
          <span>Indicators</span>
          <span v-if="enabledCount > 0" class="ind-count">{{ enabledCount }}</span>
          <svg class="caret" :class="{ open: menuOpen }" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
            <path d="M1 2.5 L4 5.5 L7 2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
        <template v-if="menuOpen">
          <div class="indicator-backdrop" @click="menuOpen = false"></div>
          <div class="indicator-dropdown">
            <label
              v-for="o in OVERLAY_META"
              :key="o.id"
              class="ind-item"
              :class="{ checked: overlays[o.id] }"
            >
              <input
                type="checkbox"
                :checked="overlays[o.id]"
                :style="{ 'accent-color': o.color }"
                @change="emit('toggle-overlay', o.id)"
              />
              <span class="ind-dot" :style="{ background: o.color }"></span>
              <span class="ind-label">{{ o.label }}</span>
            </label>
          </div>
        </template>
      </div>
    </div>
    <div class="header-right">
      <span v-if="isDemo" class="demo-badge">DEMO</span>
      <button
        class="pc-maximize"
        :title="maximized ? 'Restore chart' : 'Maximize chart'"
        aria-label="Maximize or restore chart"
        @click.stop="emit('maximize')"
      >
        <svg v-if="maximized" viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
          <path d="M9 9L9 4.5M9 9L4.5 9M9 9L3.75 3.75M9 15L9 19.5M9 15L4.5 15M9 15L3.75 20.25M15 9H19.5M15 9V4.5M15 9L20.25 3.75M15 15H19.5M15 15L15 19.5M15 15L20.25 20.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
          <path d="M3.75 3.75V8.25M3.75 3.75H8.25M3.75 3.75L9 9M3.75 20.25V15.75M3.75 20.25H8.25M3.75 20.25L9 15M20.25 3.75L15.75 3.75M20.25 3.75V8.25M20.25 3.75L15 9M20.25 20.25H15.75M20.25 20.25V15.75M20.25 20.25L15 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
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
  min-width:   0;
  flex-shrink: 1;
}

.header-right {
  display:     flex;
  align-items: center;
  gap:         8px;
  flex-shrink: 0;
}

.pc-maximize {
  appearance:    none;
  display:       flex;
  align-items:   center;
  justify-content: center;
  border:        1px solid #33363d;
  background:    #1f2128;
  color:         #9ca3af;
  width:         22px;
  height:        22px;
  padding:       0;
  border-radius: 3px;
  cursor:        pointer;
  transition:    color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
}

.pc-maximize:hover {
  color:        #d1d4dc;
  border-color: #4b5563;
  background:   #24262d;
}

.symbol {
  color:          #d1d4dc;
  font-size:      12px;
  font-weight:    700;
  letter-spacing: 0.04em;
  cursor:         pointer;
  transition:     color 0.15s ease;
  user-select:    none;
}

.symbol:hover {
  color: #fff;
}

.symbol.copied {
  color: #4ade80;
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

.demo-badge {
  color:          #4b5563;
  background:     #242424;
  font-size:      9px;
  font-weight:    700;
  padding:        1px 5px;
  border-radius:  3px;
  letter-spacing: 0.06em;
}

/* ── Indicator multi-select dropdown (same header row as symbol + timeframe) ── */
.header-divider {
  width:           1px;
  height:          14px;
  flex-shrink:     0;
  background:      #33363d;
  margin:          0 2px;
}

.indicator-menu {
  position: relative;
  display:  flex;
  align-items: center;
  flex-shrink: 0;
}

.indicator-trigger {
  appearance:     none;
  display:        flex;
  align-items:    center;
  gap:            5px;
  border:         1px solid #33363d;
  background:     #1f2128;
  color:          #9ca3af;
  font-size:      10px;
  font-weight:    700;
  letter-spacing: 0.03em;
  height:         20px;
  padding:        0 8px;
  border-radius:  3px;
  cursor:         pointer;
  transition:     color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
  white-space:    nowrap;
}

.indicator-trigger:hover {
  color:      #d1d4dc;
  border-color: #4b5563;
}

.indicator-trigger.open {
  background: #24262d;
}

.ind-count {
  background:     #c87028;
  color:          #fff;
  font-size:      9px;
  font-weight:    700;
  line-height:    13px;
  min-width:      13px;
  height:         13px;
  padding:        0 4px;
  border-radius:  7px;
  text-align:     center;
}

.caret {
  transition: transform 0.15s ease;
}

.caret.open {
  transform: rotate(180deg);
}

.indicator-backdrop {
  position: fixed;
  inset:    0;
  z-index:  40;
}

.indicator-dropdown {
  position:       absolute;
  top:            calc(100% + 6px);
  left:           0;
  z-index:        50;
  min-width:      150px;
  background:     #1a1a1a;
  border:         1px solid #2a2e39;
  border-radius:  6px;
  box-shadow:     0 6px 20px rgba(0, 0, 0, 0.55);
  padding:        4px;
  display:        flex;
  flex-direction: column;
}

.ind-item {
  display:        flex;
  align-items:    center;
  gap:            8px;
  padding:        5px 8px;
  border-radius:  4px;
  cursor:         pointer;
  color:          #d1d4dc;
  font-size:      11px;
  white-space:    nowrap;
}

.ind-item:hover {
  background: #24262d;
}

.ind-item input[type='checkbox'] {
  width:  12px;
  height: 12px;
  margin: 0;
  cursor: pointer;
  flex-shrink: 0;
}

.ind-dot {
  width:          8px;
  height:         8px;
  border-radius:  50%;
  flex-shrink:    0;
  opacity:        0.9;
}

.ind-label {
  font-weight: 600;
}
</style>
