/**
 * ET timezone helpers — canonical US Eastern session boundaries.
 *
 * All daily-bar date windows and the rolling minute window are derived from
 * ET calendar days, so incremental fetches are never off-by-one near the
 * midnight/ET boundary regardless of the server's local timezone.
 *
 * US DST: starts 02:00 ET on the 2nd Sunday of March, ends 02:00 ET on the
 * 1st Sunday of November. EST = UTC-5, EDT = UTC-4.
 */

const HOUR_MS = 3_600_000
const EST_OFFSET_MS = -5 * HOUR_MS
const EDT_OFFSET_MS = -4 * HOUR_MS

/** UTC ms of 02:00 ET on the 2nd Sunday of March (DST start). */
function dstStartUtc(year: number): number {
  const marchFirst = Date.UTC(year, 2, 1)
  const dow = new Date(marchFirst).getUTCDay() // 0 = Sunday
  const firstSunday = 1 + ((7 - dow) % 7)
  const secondSunday = firstSunday + 7
  return Date.UTC(year, 2, secondSunday, 7) // 07:00 UTC = 02:00 EST
}

/** UTC ms of 02:00 ET on the 1st Sunday of November (DST end). */
function dstEndUtc(year: number): number {
  const novFirst = Date.UTC(year, 10, 1)
  const dow = new Date(novFirst).getUTCDay()
  const firstSunday = 1 + ((7 - dow) % 7)
  return Date.UTC(year, 10, firstSunday, 6) // 06:00 UTC = 02:00 EDT
}

/** Milliseconds to add to a UTC timestamp to get the ET wall clock. */
export function etOffsetMs(ts: number): number {
  const year = new Date(ts).getUTCFullYear()
  const start = dstStartUtc(year)
  const end = dstEndUtc(year)
  return ts >= start && ts < end ? EDT_OFFSET_MS : EST_OFFSET_MS
}

/** True when the given UTC timestamp falls inside US DST. */
export function isEtDst(ts: number): boolean {
  return etOffsetMs(ts) === EDT_OFFSET_MS
}

/**
 * Convert a UTC timestamp to a Date whose UTC fields represent the ET wall
 * clock (e.g. 14:00 UTC on an EST day becomes 09:00 in the returned Date).
 */
export function toEtDate(ts: number): Date {
  return new Date(ts + etOffsetMs(ts))
}

/** ET calendar date (YYYY-MM-DD) for a UTC timestamp. */
export function etDateString(ts: number): string {
  return toEtDate(ts).toISOString().slice(0, 10)
}

/** ET calendar date string `n` calendar days before the current ET day. */
export function daysAgoEt(n: number, fromTs: number = Date.now()): string {
  const d = toEtDate(fromTs)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Current ET date string (YYYY-MM-DD). */
export function todayEt(): string {
  return etDateString(Date.now())
}

/** Yesterday's ET date string (YYYY-MM-DD). */
export function yesterdayEt(): string {
  return daysAgoEt(1)
}

/**
 * True when the given UTC timestamp falls inside a US market session window
 * (weekday, 04:00–20:00 ET — pre-market/regular/after-hours). Used to gate
 * period-elapse refetches so we don't hammer the API while the market is closed.
 */
export function isMarketSession(ts: number): boolean {
  const d = toEtDate(ts)
  const day = d.getUTCDay()
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  if (day === 0 || day === 6) return false
  return minutes >= 240 && minutes < 1200
}
