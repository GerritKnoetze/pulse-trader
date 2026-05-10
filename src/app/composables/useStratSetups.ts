import { computed, ref, watch, watchEffect, type WatchStopHandle } from 'vue'
import { useScanner } from '~/composables/useScanner'
import { useToast } from '~/composables/useToast'
import type { StratSetup, SetupQuality } from '~/types/scanner'

// ── Alert record ──────────────────────────────────────────────────────────────

export type AlertSource       = 'server' | 'user'
export type PriceAlertStatus  = 'armed' | 'triggered' | 'cancelled'

export interface SetupAlertRecord {
  id:               string
  setup:            StratSetup
  receivedAt:       string            // ISO — when client received / user armed
  read:             boolean
  dismissed:        boolean
  source:           AlertSource
  priceAlertStatus: PriceAlertStatus  // only meaningful for source === 'user'
}

// ── Module-level singleton state ──────────────────────────────────────────────

const qualityFilter  = ref<SetupQuality | null>(null)
const sortMode       = ref<'rr' | 'atrRisk' | 'detectedAt'>('rr')
const selectedSetup  = ref<StratSetup | null>(null)

// Alert history — accumulated for the session
const alertRecords   = ref<SetupAlertRecord[]>([])
let   _nextAlertId   = 0

// Map of alertId → WatchStopHandle for armed price watchers
const _priceWatchers = new Map<string, WatchStopHandle>()

// ── Alert management actions ──────────────────────────────────────────────────

function dismissAlert(id: string) {
  const rec = alertRecords.value.find(r => r.id === id)
  if (rec) rec.dismissed = true
}

function dismissAll() {
  for (const r of alertRecords.value) r.dismissed = true
}

function markAllRead() {
  for (const r of alertRecords.value) r.read = true
}

function clearDismissed() {
  alertRecords.value = alertRecords.value.filter(r => !r.dismissed)
}

function clearAll() {
  // Stop all price watchers before clearing
  for (const stop of _priceWatchers.values()) stop()
  _priceWatchers.clear()
  alertRecords.value = []
}

function cancelPriceAlert(id: string) {
  const rec = alertRecords.value.find(r => r.id === id)
  if (rec) rec.priceAlertStatus = 'cancelled'
  const stop = _priceWatchers.get(id)
  if (stop) { stop(); _priceWatchers.delete(id) }
}

// ── Wire SSE setup alerts → alert store + toast ───────────────────────────────

let _alertsWired = false
function wireAlerts() {
  if (_alertsWired || typeof window === 'undefined') return
  _alertsWired = true
  const { latestSetupAlert } = useScanner()
  const toast = useToast()
  watch(latestSetupAlert, (setup) => {
    if (!setup) return

    // Push into alert history
    const record: SetupAlertRecord = {
      id:               `alert-${_nextAlertId++}`,
      setup,
      receivedAt:       new Date().toISOString(),
      read:             false,
      dismissed:        false,
      source:           'server',
      priceAlertStatus: 'armed',       // server alerts are always "armed" until triggered
    }
    alertRecords.value.unshift(record)

    const dir = setup.direction === 'long' ? '▲ LONG' : '▼ SHORT'
    toast.info(`${setup.quality} ${setup.symbol} ${dir} — ${setup.combo} (R:R ${setup.rr})`)
  })
}

// ── User-armed price alert ────────────────────────────────────────────────────

/**
 * Called from ScannerSetupChecklist "Set Alert" button.
 * Creates a user alert record visible in the drawer, then watches live prices
 * until the entry level is crossed — firing a toast + browser notification.
 */
function armPriceAlert(setup: StratSetup): 'already-armed' | 'armed' | 'no-permission' {
  if (typeof window === 'undefined') return 'no-permission'

  // Prevent duplicate armed alerts for the same symbol+entry
  const alreadyArmed = alertRecords.value.some(
    r => r.source === 'user'
      && r.setup.symbol === setup.symbol
      && r.setup.entryPrice === setup.entryPrice
      && r.priceAlertStatus === 'armed'
  )
  if (alreadyArmed) return 'already-armed'

  const id = `alert-${_nextAlertId++}`
  const record: SetupAlertRecord = {
    id,
    setup,
    receivedAt:       new Date().toISOString(),
    read:             true,            // user explicitly armed it — no "unread" dot
    dismissed:        false,
    source:           'user',
    priceAlertStatus: 'armed',
  }
  alertRecords.value.unshift(record)

  // Watch rows for price crossing the entry level
  const { rows } = useScanner()
  const toast    = useToast()
  const fmt      = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const stop = watchEffect(() => {
    const row = rows.value.find(r => r.symbol === setup.symbol)
    if (!row) return
    const price = row.last
    const hit = setup.direction === 'long'
      ? price >= setup.entryPrice
      : price <= setup.entryPrice

    if (!hit) return

    // Mark triggered and clean up watcher
    const rec = alertRecords.value.find(r => r.id === id)
    if (rec) {
      rec.priceAlertStatus = 'triggered'
      rec.read = false    // make it unread so the badge lights up
    }
    _priceWatchers.delete(id)
    stop()

    // Toast
    const dir = setup.direction === 'long' ? '▲ LONG' : '▼ SHORT'
    toast.success(`🎯 Entry hit! ${setup.symbol} ${dir} at $${fmt(price)} (armed at $${fmt(setup.entryPrice)})`)

    // Browser notification
    if (Notification.permission === 'granted') {
      new Notification(`Entry triggered — ${setup.symbol}`, {
        body: `${dir} ${setup.combo}\nPrice $${fmt(price)} hit entry $${fmt(setup.entryPrice)}`,
        tag:  `entry-${setup.symbol}-${setup.entryPrice}`,
      })
    }
  })

  _priceWatchers.set(id, stop)
  return 'armed'
}

// ── Composable ─────────────────────────────────────────────────────────────────

export function useStratSetups() {
  wireAlerts()

  const { rows } = useScanner()

  const allSetups = computed<StratSetup[]>(() =>
    rows.value
      .filter(r => r.setup != null)
      .map(r => r.setup!)
  )

  const filteredSetups = computed<StratSetup[]>(() => {
    let s = allSetups.value
    if (qualityFilter.value) {
      s = s.filter(x => x.quality === qualityFilter.value)
    }
    return [...s].sort((a, b) => {
      if (sortMode.value === 'rr')        return b.rr - a.rr
      if (sortMode.value === 'atrRisk')   return a.atrRisk - b.atrRisk
      return b.detectedAt.localeCompare(a.detectedAt)
    })
  })

  const setupBadgeCount = computed(() =>
    allSetups.value.filter(s => s.quality === 'A+' || s.quality === 'A').length
  )

  const visibleAlerts = computed(() =>
    alertRecords.value.filter(r => !r.dismissed)
  )

  /** Total non-dismissed alerts — used for the side-strip badge */
  const alertBadgeCount = computed(() => visibleAlerts.value.length)

  const unreadAlertCount = computed(() =>
    alertRecords.value.filter(r => !r.read && !r.dismissed).length
  )

  /** True if a user-armed price alert is already active for this setup's entry level */
  function isAlertArmed(setup: StratSetup): boolean {
    return alertRecords.value.some(
      r => r.source === 'user'
        && r.setup.symbol === setup.symbol
        && r.setup.entryPrice === setup.entryPrice
        && r.priceAlertStatus === 'armed'
    )
  }

  function setQualityFilter(q: SetupQuality | null) {
    qualityFilter.value = qualityFilter.value === q ? null : q
  }
  function setSortMode(m: 'rr' | 'atrRisk' | 'detectedAt') { sortMode.value = m }
  function selectSetup(setup: StratSetup | null) { selectedSetup.value = setup }

  return {
    allSetups,
    filteredSetups,
    setupBadgeCount,
    qualityFilter,
    sortMode,
    selectedSetup,
    alertRecords,
    visibleAlerts,
    alertBadgeCount,
    unreadAlertCount,
    setQualityFilter,
    setSortMode,
    selectSetup,
    isAlertArmed,
    armPriceAlert,
    dismissAlert,
    dismissAll,
    markAllRead,
    clearDismissed,
    clearAll,
    cancelPriceAlert,
  }
}
