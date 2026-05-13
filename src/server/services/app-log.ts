/**
 * App-Log — lightweight in-memory circular log buffer with SSE fan-out.
 *
 * Usage (server-side):
 *   import { appLog } from '~/server/services/app-log'
 *   appLog('Scan started — 4 201 candidates')
 *   appLog('Rate limit hit for TSLA', 'warn')
 *
 * The SSE endpoint at /api/scanner/logs streams new entries to all
 * connected clients in real time.
 */

export interface AppLogEntry {
  id:    number
  ts:    number
  level: 'info' | 'warn' | 'error'
  msg:   string
  detail?: string   // technical detail shown only when debug mode is on
}

type SseWriter = (entry: AppLogEntry) => void

const MAX_BUFFER = 500
const buffer: AppLogEntry[] = []
let   nextId = 1
const clients = new Map<string, SseWriter>()

export function appLog(msg: string, level: AppLogEntry['level'] = 'info', detail?: string): void {
  const entry: AppLogEntry = { id: nextId++, ts: Date.now(), level, msg, ...(detail !== undefined && { detail }) }
  buffer.push(entry)
  if (buffer.length > MAX_BUFFER) buffer.shift()
  for (const writer of clients.values()) {
    try { writer(entry) } catch { /* disconnected */ }
  }
}

export function getLogBuffer(): AppLogEntry[] { return [...buffer] }
export function addLogClient(id: string, writer: SseWriter): void { clients.set(id, writer) }
export function removeLogClient(id: string): void { clients.delete(id) }
