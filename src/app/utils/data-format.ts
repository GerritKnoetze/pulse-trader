// Client-side ET helpers (mirror of src/server/utils/et-time.ts, kept
// dependency-free so the client bundle never imports from the server dir).

const HOUR_MS = 3_600_000
const EST_OFFSET_MS = -5 * HOUR_MS
const EDT_OFFSET_MS = -4 * HOUR_MS

function dstStartUtc(year: number): number {
  const marchFirst = Date.UTC(year, 2, 1)
  const dow = new Date(marchFirst).getUTCDay()
  const firstSunday = 1 + ((7 - dow) % 7)
  return Date.UTC(year, 2, firstSunday + 7, 7)
}

function dstEndUtc(year: number): number {
  const novFirst = Date.UTC(year, 10, 1)
  const dow = new Date(novFirst).getUTCDay()
  const firstSunday = 1 + ((7 - dow) % 7)
  return Date.UTC(year, 10, firstSunday, 6)
}

function etOffsetMs(ts: number): number {
  const year = new Date(ts).getUTCFullYear()
  const start = dstStartUtc(year)
  const end = dstEndUtc(year)
  return ts >= start && ts < end ? EDT_OFFSET_MS : EST_OFFSET_MS
}

/**
 * Return a Date whose UTC fields represent the ET wall clock for `ts`.
 */
export function etDate(ts: number): Date {
  return new Date(ts + etOffsetMs(ts))
}

/** "YYYY-MM-DD HH:mm:ss" in ET. */
export function formatTs(ts: number): string {
  const d = etDate(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/** "YYYY-MM-DD HH:mm" in ET. */
export function formatTsMin(ts: number): string {
  const d = etDate(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** "YYYY-MM-DD" in ET. */
export function formatDate(ts: number): string {
  const d = etDate(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/** Value for a <input type="datetime-local"> — ET wall clock, no tz suffix. */
export function tsToInput(ts: number): string {
  const d = etDate(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** Parse an <input type="datetime-local"> value (ET wall clock) back to UTC ms. */
export function inputToTs(value: string): number {
  const parsedUtc = Date.parse(`${value}:00Z`)
  if (Number.isNaN(parsedUtc)) return 0
  // Iterate once on the DST offset so ET-local input round-trips to UTC ms.
  return parsedUtc - etOffsetMs(parsedUtc)
}

export function formatNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export function formatDuration(ms: number): string {
  if (ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
