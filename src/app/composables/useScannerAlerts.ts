import { computed, ref } from 'vue'
import { useToast } from '~/composables/useToast'
import { registerAlertFrameHandler, type ScannerAlertFrame } from '~/composables/useScanner'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertLevel = 'info' | 'success' | 'warn' | 'error'

export interface ScannerAlert {
  id:         string
  title:      string
  message:    string
  level:      AlertLevel
  receivedAt: string
  read:       boolean
  dismissed:  boolean
}

// ── Module-level singleton state ──────────────────────────────────────────────

// Alert history — accumulated for the session
const alertRecords = ref<ScannerAlert[]>([])
let   _nextAlertId = 0

// ── Alert creation ────────────────────────────────────────────────────────────

/**
 * Create a new alert and push it into the drawer history, firing a toast and
 * (when permitted) a browser notification. Any new alert logic — server or
 * client — funnels through here.
 */
function pushAlert(input: { title: string; message?: string; level?: AlertLevel }): ScannerAlert {
  const record: ScannerAlert = {
    id:         `alert-${_nextAlertId++}`,
    title:      input.title,
    message:    input.message ?? '',
    level:      input.level ?? 'info',
    receivedAt: new Date().toISOString(),
    read:       false,
    dismissed:  false,
  }
  alertRecords.value.unshift(record)

  const toast = useToast()
  const notify = record.level === 'success'
    ? toast.success
    : record.level === 'warn'
      ? toast.warning
      : record.level === 'error'
        ? toast.error
        : toast.info
  notify(`${record.title}${record.message ? ` — ${record.message}` : ''}`)

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(record.title, { body: record.message || undefined, tag: `alert-${record.id}` })
    } catch { /* some browsers throw on Notification constructor */ }
  }

  return record
}

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
  alertRecords.value = []
}

// ── Computed ──────────────────────────────────────────────────────────────────

const visibleAlerts = computed(() => alertRecords.value.filter(r => !r.dismissed))

/** Total non-dismissed alerts — used for the side-strip badge */
const alertBadgeCount = computed(() => visibleAlerts.value.length)

const unreadAlertCount = computed(() =>
  alertRecords.value.filter(r => !r.read && !r.dismissed).length
)

// ── SSE alert frame → store ───────────────────────────────────────────────────

let _alertsWired = false
function wireAlerts() {
  if (_alertsWired || typeof window === 'undefined') return
  _alertsWired = true
  registerAlertFrameHandler((frame: ScannerAlertFrame) => {
    pushAlert({ ...frame.alert, level: frame.alert.level as AlertLevel })
  })
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useScannerAlerts() {
  wireAlerts()
  return {
    alertRecords,
    visibleAlerts,
    alertBadgeCount,
    unreadAlertCount,
    pushAlert,
    dismissAlert,
    dismissAll,
    markAllRead,
    clearDismissed,
    clearAll,
  }
}
