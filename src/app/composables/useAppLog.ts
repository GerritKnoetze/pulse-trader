import { ref, readonly } from 'vue'

export interface AppLogEntry {
  id:    number
  ts:    number
  level: 'info' | 'warn' | 'error'
  msg:   string
  detail?: string
}

const MAX_ENTRIES = 500
const entries = ref<AppLogEntry[]>([])
let es: EventSource | null = null

function connect() {
  if (es) return
  es = new EventSource('/api/scanner/logs')

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type === 'history') {
        // Pre-populate with buffered server-side history
        entries.value = (data.entries as AppLogEntry[]).slice(-MAX_ENTRIES)
      } else if (data.id && data.msg) {
        // Single new entry
        entries.value.push(data as AppLogEntry)
        if (entries.value.length > MAX_ENTRIES) entries.value.shift()
      }
    } catch { /* ignore malformed */ }
  }

  es.onerror = () => {
    // SSE will auto-reconnect; just note it
  }
}

function disconnect() {
  es?.close()
  es = null
}

function clearLog() {
  entries.value = []
}

export function useAppLog() {
  return {
    entries: readonly(entries),
    connect,
    disconnect,
    clearLog,
  }
}
