<script setup lang="ts">
import { ref } from 'vue'
import { BoltIcon } from '@heroicons/vue/24/outline'
import { useStratSetups } from '~/composables/useStratSetups'
import ScannerSetupChecklist from '~/components/scanner/ScannerSetupChecklist.vue'
import type { SetupQuality, StratSetup } from '~/types/scanner'

defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const {
  filteredSetups,
  qualityFilter,
  sortMode,
  selectedSetup,
  setQualityFilter,
  setSortMode,
  selectSetup,
} = useStratSetups()

const GRADES: SetupQuality[] = ['A+', 'A', 'B', 'C']
const SORT_OPTIONS: Array<{ value: 'rr' | 'atrRisk' | 'detectedAt'; label: string }> = [
  { value: 'rr',         label: 'R:R'  },
  { value: 'atrRisk',    label: 'ATR'  },
  { value: 'detectedAt', label: 'Time' },
]

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dirLabel(s: StratSetup) { return s.direction === 'long' ? '▲' : '▼' }
function dirClass(s: StratSetup) { return s.direction === 'long' ? 'long' : 'short' }
function qualityClass(q: string) { return `quality-${q.replace('+', 'plus')}` }

function continuityLabel(s: StratSetup) {
  switch (s.tfContinuity) {
    case 'full':       return `✓ Full continuity${s.ftfc ? ' · FTFC' : ''}`
    case 'partial':    return `~ Partial continuity`
    case 'conflicted': return `✗ Higher TF conflict`
    case 'blocked':    return `⊘ Blocked`
    default:           return ''
  }
}
function continuityClass(s: StratSetup) {
  switch (s.tfContinuity) {
    case 'full':       return 'cont-full'
    case 'partial':    return 'cont-partial'
    case 'conflicted': return 'cont-conflict'
    default:           return 'cont-partial'
  }
}

function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)   return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}
</script>

<template>
  <div class="side-drawer" :class="{ open }">
    <!-- Header -->
    <div class="drawer-header">
      <div class="drawer-header-left">
        <BoltIcon class="drawer-header-icon" />
        <span class="drawer-title">Live Setups</span>
      </div>
      <button class="drawer-close-btn" @click="$emit('close')">✕</button>
    </div>

    <!-- Checklist view (selected setup) -->
    <template v-if="selectedSetup">
      <ScannerSetupChecklist :setup="selectedSetup" :show-back="true" @back="selectSetup(null)" />
    </template>

    <!-- List view -->
    <template v-else>
      <!-- Filter bar -->
      <div class="filter-bar">
        <button
          v-for="grade in GRADES"
          :key="grade"
          class="grade-btn"
          :class="[qualityClass(grade), { active: qualityFilter === grade }]"
          @click="setQualityFilter(grade)"
        >{{ grade }}</button>

        <select class="sort-select" :value="sortMode" @change="setSortMode(($event.target as HTMLSelectElement).value as typeof sortMode)">
          <option v-for="opt in SORT_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>

      <div class="drawer-divider" />

      <!-- Setup cards -->
      <div class="setups-scroll">
        <div v-if="filteredSetups.length === 0" class="setups-empty">
          No setups detected yet.<br>Run a scan to populate.
        </div>

        <button
          v-for="setup in filteredSetups"
          :key="`${setup.symbol}-${setup.combo}`"
          class="setup-card"
          @click="selectSetup(setup)"
        >
          <!-- Card header row -->
          <div class="card-header">
            <span class="card-symbol">{{ setup.symbol }}</span>
            <span :class="['quality-badge', qualityClass(setup.quality)]">{{ setup.quality }}</span>
            <span :class="['dir-badge', dirClass(setup)]">{{ dirLabel(setup) }} {{ setup.direction.toUpperCase() }}</span>
            <span class="card-age">{{ relativeTime(setup.detectedAt) }}</span>
          </div>

          <!-- Combo name -->
          <div class="card-combo">{{ setup.signalTf }}: {{ setup.combo }}</div>

          <!-- Levels row -->
          <div class="card-levels">
            <span class="lvl entry">E ${{ fmt(setup.entryPrice) }}</span>
            <span class="lvl stop">S ${{ fmt(setup.stop) }}</span>
            <span v-if="setup.targets[0]" class="lvl target">T1 ${{ fmt(setup.targets[0]) }}</span>
          </div>

          <!-- R:R + continuity row -->
          <div class="card-meta">
            <span class="card-rr">R:R {{ setup.rr }}</span>
            <span class="card-sep">·</span>
            <span class="card-atr">{{ setup.atrRisk }}× ATR</span>
            <span class="card-sep">·</span>
            <span :class="['card-cont', continuityClass(setup)]">{{ continuityLabel(setup) }}</span>
          </div>

          <!-- inForce indicator -->
          <span v-if="setup.inForce" class="in-force-badge">⚡ In Force</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.side-drawer {
  width: 0;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #161616;
  border-left: 1px solid transparent;
  transition: width 0.22s ease, border-color 0.22s ease;
}
.side-drawer.open {
  width: 300px;
  border-left-color: var(--color-border);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.drawer-header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.drawer-header-icon {
  width: 1rem;
  height: 1rem;
  color: var(--color-primary);
  flex-shrink: 0;
}
.drawer-title {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text);
}
.drawer-close-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.1rem 0.25rem;
}
.drawer-close-btn:hover { color: var(--color-text); }

.drawer-divider {
  height: 1px;
  background: var(--color-border);
  flex-shrink: 0;
}

/* Filter bar */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.45rem 0.75rem;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.grade-btn {
  font-size: 0.65rem;
  font-weight: 800;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  border: 1px solid transparent;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s;
}
.grade-btn.active, .grade-btn:hover { opacity: 1; }
.grade-btn.quality-Aplus  { background: #2a5c2a; color: #6dde6d; border-color: #4a9c4a; }
.grade-btn.quality-A      { background: #1e4a1e; color: #4fc34f; border-color: #3a7a3a; }
.grade-btn.quality-B      { background: #3a3a1a; color: #c8c840; border-color: #6a6a30; }
.grade-btn.quality-C      { background: #3a1a1a; color: #c84040; border-color: #6a3030; }

.sort-select {
  margin-left: auto;
  background: var(--color-background-mute);
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  font-size: 0.65rem;
  padding: 0.15rem 0.3rem;
  border-radius: 3px;
  cursor: pointer;
}
.sort-select:focus { outline: none; border-color: var(--color-primary); }

/* Scroll area */
.setups-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0.4rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-height: 0;
}

.setups-empty {
  text-align: center;
  color: var(--color-text-soft);
  font-size: 0.72rem;
  padding: 1.5rem 0.5rem;
  line-height: 1.6;
}

/* Setup card */
.setup-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 0.5rem 0.6rem;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background 0.15s, border-color 0.15s;
}
.setup-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.card-symbol {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--color-text);
}

.quality-badge {
  font-size: 0.62rem;
  font-weight: 800;
  padding: 0.1rem 0.28rem;
  border-radius: 3px;
  flex-shrink: 0;
}
.quality-Aplus  { background: #2a5c2a; color: #6dde6d; }
.quality-A      { background: #1e4a1e; color: #4fc34f; }
.quality-B      { background: #3a3a1a; color: #c8c840; }
.quality-C      { background: #3a1a1a; color: #c84040; }

.dir-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}
.dir-badge.long  { color: #4fc34f; background: rgba(40, 120, 40, 0.2); }
.dir-badge.short { color: #e05050; background: rgba(180, 40, 40, 0.2); }

.card-age {
  margin-left: auto;
  font-size: 0.6rem;
  color: var(--color-text-soft);
  white-space: nowrap;
}

.card-combo {
  font-size: 0.7rem;
  color: var(--color-text-soft);
}

.card-levels {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.lvl {
  font-size: 0.68rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.lvl.entry  { color: #6ab0ff; }
.lvl.stop   { color: #ff8080; }
.lvl.target { color: #70d080; }

.card-meta {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
  font-size: 0.65rem;
}
.card-rr  { font-weight: 700; color: var(--color-text); }
.card-atr { color: var(--color-text-soft); }
.card-sep { color: var(--color-text-soft); }
.cont-full     { color: #5dde5d; }
.cont-partial  { color: #c8c840; }
.cont-conflict { color: #e05050; }

.in-force-badge {
  font-size: 0.6rem;
  font-weight: 700;
  color: #f0c040;
  letter-spacing: 0.03em;
}
</style>
