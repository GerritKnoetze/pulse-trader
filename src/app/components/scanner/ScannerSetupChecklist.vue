<script setup lang="ts">
import { computed } from 'vue'
import { useScanner } from '~/composables/useScanner'
import { useToast } from '~/composables/useToast'
import { useStratSetups } from '~/composables/useStratSetups'
import { useChartTabs } from '~/composables/useChartTabs'
import type { StratSetup } from '~/types/scanner'

const props = defineProps<{ setup: StratSetup }>()
const emit  = defineEmits<{ back: [] }>()

const { rows } = useScanner()
const toast = useToast()
const { armPriceAlert, isAlertArmed } = useStratSetups()
const { openTab } = useChartTabs()

function openChart() {
  openTab(props.setup.symbol, props.setup.entryPrice, props.setup)
}

// Live price for the symbol from the row cache
const currentPrice = computed(() => {
  const row = rows.value.find(r => r.symbol === props.setup.symbol)
  return row?.last ?? null
})

const alertArmed = computed(() => isAlertArmed(props.setup))

// ── Checklist step states ─────────────────────────────────────────────────────

// Higher TF checks: W, M, Q, Y for a D signal
const tfChecks = computed(() => {
  const s = props.setup
  const higherTfs: Array<{ label: string; dir: 'up' | 'down'; aligned: boolean }> = []
  const tfMap = { W: 'W', M: 'M', Q: 'Q', Y: 'Y' } as const
  for (const [tf] of Object.entries(tfMap)) {
    const key = tf as 'W' | 'M' | 'Q' | 'Y'
    // We need the row's mtf for these; re-fetch from rows
    const row = rows.value.find(r => r.symbol === s.symbol)
    if (!row) continue
    const dir = row.mtf[key]
    const expected = s.direction === 'long' ? 'up' : 'down'
    higherTfs.push({ label: tf, dir, aligned: dir === expected })
  }
  return higherTfs
})

const entryTriggered = computed(() => {
  const price = currentPrice.value
  if (price == null) return false
  return props.setup.direction === 'long'
    ? price >= props.setup.entryPrice
    : price <= props.setup.entryPrice
})

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDir(s: StratSetup) {
  return s.direction === 'long' ? 'above' : 'below'
}

// ── Actions ───────────────────────────────────────────────────────────────────

function copyTradeParams() {
  const s = props.setup
  const text = [
    `Symbol:  ${s.symbol}`,
    `Combo:   ${s.combo}`,
    `Dir:     ${s.direction.toUpperCase()}`,
    `Entry:   $${fmt(s.entryPrice)}`,
    `Stop:    $${fmt(s.stop)}`,
    ...s.targets.map((t, i) => `T${i + 1}:     $${fmt(t)}`),
    `R:R:     ${s.rr}`,
    `ATR Rsk: ${s.atrRisk}×`,
    `Quality: ${s.quality}`,
  ].join('\n')

  navigator.clipboard.writeText(text)
    .then(() => toast.success('Trade params copied to clipboard'))
    .catch(() => toast.error('Clipboard unavailable'))
}

async function setAlert() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    toast.warning('Browser notifications not supported')
    return
  }

  // Request permission if not yet granted
  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') {
      toast.warning('Notification permission denied — alert will still appear in the Alerts drawer')
    }
  } else if (Notification.permission === 'denied') {
    toast.warning('Notifications blocked — alert will still appear in the Alerts drawer')
  }

  const result = armPriceAlert(props.setup)
  if (result === 'already-armed') {
    toast.info(`Alert already armed for ${props.setup.symbol} at $${fmt(props.setup.entryPrice)}`)
  } else {
    toast.success(`Alert armed — watching ${props.setup.symbol} for break ${props.setup.direction === 'long' ? 'above' : 'below'} $${fmt(props.setup.entryPrice)}`)
  }
}
</script>

<template>
  <div class="checklist">
    <!-- Header -->
    <div class="checklist-header">
      <button class="back-btn" @click="$emit('back')">← Back</button>
      <span class="checklist-title">
        <span :class="['quality-badge', `quality-${setup.quality.replace('+', 'plus')}`]">{{ setup.quality }}</span>
        {{ setup.symbol }} {{ setup.direction.toUpperCase() }}
      </span>
    </div>

    <div class="checklist-subtitle">{{ setup.signalTf }}: {{ setup.combo }}</div>

    <!-- Steps -->
    <ol class="step-list">
      <!-- Step 1: Combo identified -->
      <li class="step step-done">
        <span class="step-icon">✓</span>
        <span class="step-text">
          {{ setup.signalTf }} combo identified: <strong>{{ setup.combo }}</strong>
        </span>
      </li>

      <!-- Steps 2–N: Higher TF checks -->
      <li
        v-for="check in tfChecks"
        :key="check.label"
        class="step"
        :class="check.aligned ? 'step-done' : 'step-warn'"
      >
        <span class="step-icon">{{ check.aligned ? '✓' : '✗' }}</span>
        <span class="step-text">
          {{ check.label }} is <strong>{{ check.dir }}</strong>
          {{ !check.aligned ? '(conflicting)' : '' }}
        </span>
      </li>

      <!-- FTFC -->
      <li class="step" :class="setup.ftfc ? 'step-done' : 'step-warn'">
        <span class="step-icon">{{ setup.ftfc ? '✓' : '✗' }}</span>
        <span class="step-text">
          FTFC: <strong>{{ setup.ftfc ? 'Full continuity' : 'Partial / conflicted' }}</strong>
        </span>
      </li>

      <!-- Entry trigger -->
      <li class="step" :class="entryTriggered ? 'step-done' : 'step-pending'">
        <span class="step-icon">{{ entryTriggered ? '✓' : '○' }}</span>
        <span class="step-text">
          {{ entryTriggered ? 'Entry triggered' : `Wait for break ${fmtDir(setup)} $${fmt(setup.entryPrice)}` }}
          <span v-if="currentPrice" class="live-price">(now ${{ fmt(currentPrice) }})</span>
        </span>
      </li>

      <!-- Enter + Stop -->
      <li class="step" :class="entryTriggered ? 'step-done' : 'step-pending'">
        <span class="step-icon">{{ entryTriggered ? '✓' : '○' }}</span>
        <span class="step-text">
          Enter {{ setup.direction.toUpperCase() }} at
          <strong>${{ fmt(setup.entryPrice) }}</strong>
          · Stop <strong>${{ fmt(setup.stop) }}</strong>
          <span class="step-meta">(risk ${{ fmt(Math.abs(setup.entryPrice - setup.stop)) }} · {{ setup.atrRisk }}× ATR)</span>
        </span>
      </li>

      <!-- Targets -->
      <li
        v-for="(target, i) in setup.targets"
        :key="i"
        class="step step-pending"
      >
        <span class="step-icon">○</span>
        <span class="step-text">
          {{ i === 0 ? 'Scale out 50% at' : 'Runner to' }}
          T{{ i + 1 }} <strong>${{ fmt(target) }}</strong>
          <span class="step-meta">(R:R {{ i === 0 ? setup.rr : '' }}{{ i > 0 ? '…' : '' }})</span>
        </span>
      </li>
    </ol>

    <!-- Level summary -->
    <div class="levels-grid">
      <div class="level-item level-entry">
        <span class="level-label">Entry</span>
        <span class="level-value">${{ fmt(setup.entryPrice) }}</span>
      </div>
      <div class="level-item level-stop">
        <span class="level-label">Stop</span>
        <span class="level-value">${{ fmt(setup.stop) }}</span>
      </div>
      <div v-for="(t, i) in setup.targets" :key="i" class="level-item level-target">
        <span class="level-label">T{{ i + 1 }}</span>
        <span class="level-value">${{ fmt(t) }}</span>
      </div>
    </div>

    <!-- R:R summary -->
    <div class="rr-bar">
      <span class="rr-value">R:R {{ setup.rr }}</span>
      <span class="rr-sep">·</span>
      <span class="rr-atr">{{ setup.atrRisk }}× ATR risk</span>
    </div>

    <!-- Actions -->
    <div class="checklist-actions">
      <button class="action-btn" @click="openChart">📈 Open Chart</button>
      <button
        class="action-btn"
        :class="{ 'action-btn--armed': alertArmed }"
        @click="setAlert"
      >{{ alertArmed ? '🔔 Alert Armed' : '🔔 Set Alert' }}</button>
      <button class="action-btn" @click="copyTradeParams">📋 Copy Params</button>
    </div>
  </div>
</template>

<style scoped>
.checklist {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0.5rem 0.75rem 0.75rem;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.checklist-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.2rem;
}

.back-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.72rem;
  padding: 0.15rem 0;
  flex-shrink: 0;
}
.back-btn:hover { text-decoration: underline; }

.checklist-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.checklist-subtitle {
  font-size: 0.7rem;
  color: var(--color-text-soft);
  margin-bottom: 0.6rem;
}

/* Quality badges */
.quality-badge {
  font-size: 0.68rem;
  font-weight: 800;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  flex-shrink: 0;
}
.quality-Aplus  { background: #2a5c2a; color: #6dde6d; }
.quality-A      { background: #1e4a1e; color: #4fc34f; }
.quality-B      { background: #3a3a1a; color: #c8c840; }
.quality-C      { background: #3a1a1a; color: #c84040; }

/* Steps */
.step-list {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  font-size: 0.72rem;
  line-height: 1.4;
  padding: 0.25rem 0.35rem;
  border-radius: 4px;
}

.step-done    { background: rgba(40, 100, 40, 0.15); color: var(--color-text); }
.step-warn    { background: rgba(180, 60, 60, 0.15);  color: #e08080; }
.step-pending { background: rgba(60, 60, 60, 0.2);    color: var(--color-text-soft); }

.step-icon {
  font-size: 0.7rem;
  width: 12px;
  flex-shrink: 0;
  margin-top: 0.05rem;
}
.step-done .step-icon    { color: #5dde5d; }
.step-warn .step-icon    { color: #e05050; }
.step-pending .step-icon { color: #888; }

.step-text { flex: 1; }
.step-meta { opacity: 0.75; margin-left: 0.25rem; }
.live-price { color: var(--color-primary); margin-left: 0.25rem; }

/* Levels grid */
.levels-grid {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
}

.level-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.25rem 0.4rem;
  border-radius: 4px;
  min-width: 48px;
}

.level-label { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.level-value { font-size: 0.72rem; font-weight: 600; font-variant-numeric: tabular-nums; }

.level-entry  { background: rgba(30, 100, 180, 0.18); }
.level-entry .level-label  { color: #6ab0ff; }
.level-entry .level-value  { color: #a8d0ff; }
.level-stop   { background: rgba(180, 40, 40, 0.18); }
.level-stop .level-label   { color: #ff8080; }
.level-stop .level-value   { color: #ffb0b0; }
.level-target { background: rgba(40, 140, 60, 0.18); }
.level-target .level-label { color: #70d080; }
.level-target .level-value { color: #a0e8b0; }

/* R:R bar */
.rr-bar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.7rem;
  color: var(--color-text-soft);
  margin-bottom: 0.6rem;
}
.rr-value { font-weight: 700; color: var(--color-text); }

/* Actions */
.checklist-actions {
  display: flex;
  gap: 0.4rem;
}

.action-btn {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  font-size: 0.68rem;
  padding: 0.35rem 0.4rem;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
  transition: all 0.15s ease;
}
.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text);
}
.action-btn--armed {
  background: rgba(200, 118, 40, 0.15);
  border-color: #c87628;
  color: #c87628;
}
.action-btn--armed:hover {
  background: rgba(200, 118, 40, 0.25);
}
</style>
