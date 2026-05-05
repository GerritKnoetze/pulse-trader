/**
 * TA Calculator — pure, stateless functions implementing "The Strat" methodology.
 *
 * Bar-type nomenclature (The Strat):
 *   1  = Inside bar  — high ≤ prev high AND low ≥ prev low
 *   2u = Up bar      — high > prev high AND low ≥ prev low
 *   2d = Down bar    — high ≤ prev high AND low < prev low
 *   3  = Outside bar — high > prev high AND low < prev low
 */

import type { BarInput } from '../database/repositories/market-data-repository'

// ── Shared types (duplicated to avoid cross-boundary import) ──────────────────

export type ScannerCategory = 'Continuation' | 'Continuation+' | 'Inside' | 'Reversal' | ''
export type MtfSignal = 'up' | 'down'
export interface MtfState { '1': MtfSignal; '5': MtfSignal; '15': MtfSignal; '30': MtfSignal; '60': MtfSignal; D: MtfSignal; W: MtfSignal; M: MtfSignal; Q: MtfSignal; Y: MtfSignal }

export interface ScannerRowTA {
  symbol: string
  last: number
  chgDollar: number
  chgPct: number
  sector: string
  atrPct: number
  atrDollar: number
  avgVol30: number
  inForce: boolean
  ftfc: boolean
  mtf: MtfState
  cc: string
  cc1: string
  cc2: string
  pattern: string
  signal: string
  category: ScannerCategory
}

// ── Bar type ─────────────────────────────────────────────────────────────────

export type BarType = '1' | '2u' | '2d' | '3'

export function getBarType(curr: BarInput, prev: BarInput): BarType {
  const newHigh = curr.high > prev.high
  const newLow = curr.low < prev.low
  if (newHigh && newLow) return '3'
  if (newHigh) return '2u'
  if (newLow) return '2d'
  return '1'
}

// ── CC codes (last 3 bar types) ───────────────────────────────────────────────

export interface CcCodes {
  cc: string   // current bar type
  cc1: string  // previous bar type
  cc2: string  // two-bars-ago bar type
}

export function computeCcCodes(bars: BarInput[]): CcCodes {
  if (bars.length < 2) return { cc: '', cc1: '', cc2: '' }
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp)
  const n = sorted.length
  const cc  = n >= 2 ? getBarType(sorted[n - 1]!, sorted[n - 2]!) : ''
  const cc1 = n >= 3 ? getBarType(sorted[n - 2]!, sorted[n - 3]!) : ''
  const cc2 = n >= 4 ? getBarType(sorted[n - 3]!, sorted[n - 4]!) : ''
  return { cc, cc1, cc2 }
}

// ── Pattern string ─────────────────────────────────────────────────────────────

export function computePattern(codes: CcCodes): string {
  const parts = [codes.cc2, codes.cc1, codes.cc].filter(Boolean)
  return parts.join('-')
}

// ── Signal name ────────────────────────────────────────────────────────────────

const SIGNAL_MAP: Record<string, string> = {
  // 2-bar patterns (cc1-cc)
  '2u-2u':   '2-2 Up Cont.',
  '2d-2d':   '2-2 Down Cont.',
  '1-2u':    'Inside Up',
  '1-2d':    'Inside Down',
  '3-2u':    '3-2u Expansion',
  '3-2d':    '3-2d Expansion',
  '2u-2d':   '2-2 Reversal',
  '2d-2u':   '2-2 Reversal',
  '2u-1':    'Inside Bar',
  '2d-1':    'Inside Bar',
  '3-1':     '3-1 Setup',
  '1-1':     'Inside Bar',
  '2u-3':    '3 Broadening',
  '2d-3':    '3 Broadening',
  '1-3':     '3 Outside',
  '3-3':     '3 Broadening',
  // 3-bar patterns (cc2-cc1-cc)
  '1-3-2u':   '3-2 Expansion +',
  '1-3-2d':   '3-2 Expansion -',
  '2u-2d-2u': '2-2-2 Green',
  '2d-2u-2d': '2-2-2 Red',
  '2u-3-1':   '3-1 Expansion',
  '2d-3-1':   '3-1 Expansion',
  '3-2d-1':   '3-2-1 Setup',
  '3-2u-1':   '3-2-1 Setup',
}

export function computeSignal(codes: CcCodes): string {
  const threeBar = `${codes.cc2}-${codes.cc1}-${codes.cc}`
  if (codes.cc2 && SIGNAL_MAP[threeBar]) return SIGNAL_MAP[threeBar]!
  const twoBar = `${codes.cc1}-${codes.cc}`
  return SIGNAL_MAP[twoBar] ?? `${codes.cc} Bar`
}

// ── Category ───────────────────────────────────────────────────────────────────

export function computeCategory(codes: CcCodes, ftfc: boolean): ScannerCategory {
  const twoBar = `${codes.cc1}-${codes.cc}`
  if (twoBar === '2u-2u' || twoBar === '2d-2d') {
    return ftfc ? 'Continuation+' : 'Continuation'
  }
  if (codes.cc === '1') return 'Inside'
  const bullReversal = (codes.cc1 === '2d' || codes.cc1 === '3') && codes.cc === '2u'
  const bearReversal = (codes.cc1 === '2u' || codes.cc1 === '3') && codes.cc === '2d'
  if (bullReversal || bearReversal) return 'Reversal'
  if (codes.cc === '2u' || codes.cc === '2d') return 'Continuation'
  return ''
}

// ── inForce ────────────────────────────────────────────────────────────────────
// True when price has "triggered" the setup: exceeded the previous bar's relevant extreme.

export function computeInForce(bars: BarInput[]): boolean {
  if (bars.length < 2) return false
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp)
  const curr = sorted[sorted.length - 1]!
  const prev = sorted[sorted.length - 2]!
  const type = getBarType(curr, prev)
  if (type === '2u' || type === '3') return curr.close > prev.high
  if (type === '2d') return curr.close < prev.low
  // Inside bar: in force if close exceeds previous bar's high (long side)
  return curr.close > prev.high
}

// ── ATR14 ─────────────────────────────────────────────────────────────────────

export function computeATR(bars: BarInput[], period = 14): { atrDollar: number; atrPct: number } {
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp)
  if (sorted.length < 2) return { atrDollar: 0, atrPct: 0 }
  const trs: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const curr = sorted[i]!
    trs.push(Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    ))
  }
  const slice = trs.slice(-period)
  const atrDollar = slice.reduce((a, b) => a + b, 0) / slice.length
  const lastClose = sorted[sorted.length - 1]!.close
  const atrPct = lastClose > 0 ? (atrDollar / lastClose) * 100 : 0
  return {
    atrDollar: Math.round(atrDollar * 100) / 100,
    atrPct: Math.round(atrPct * 100) / 100,
  }
}

// ── Average Volume (30-day) ───────────────────────────────────────────────────

export function computeAvgVol30(bars: BarInput[]): number {
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp)
  const slice = sorted.slice(-30)
  if (slice.length === 0) return 0
  return Math.round(slice.reduce((s, b) => s + b.volume, 0) / slice.length)
}

// ── Bar aggregation (daily → weekly/monthly/quarterly/yearly) ─────────────────

function isoWeekKey(ts: number): string {
  const d = new Date(ts)
  const day = d.getUTCDay() || 7          // 1=Mon … 7=Sun
  const thu = new Date(d)
  thu.setUTCDate(d.getUTCDate() + 4 - day) // nearest Thursday (ISO week)
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((thu.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7)
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function monthKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function quarterKey(ts: number): string {
  const d = new Date(ts)
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  return `${d.getUTCFullYear()}-Q${q}`
}

function yearKey(ts: number): string {
  return String(new Date(ts).getUTCFullYear())
}

function aggregateBars(
  dailyBars: BarInput[],
  keyFn: (ts: number) => string,
  timespan: string,
): BarInput[] {
  const buckets = new Map<string, BarInput[]>()
  for (const b of dailyBars) {
    const k = keyFn(b.timestamp)
    const arr = buckets.get(k) ?? []
    arr.push(b)
    buckets.set(k, arr)
  }
  const result: BarInput[] = []
  for (const [, bars] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    result.push({
      ticker: bars[0]!.ticker,
      timespan,
      timestamp: bars[0]!.timestamp,
      open: bars[0]!.open,
      high: Math.max(...bars.map(b => b.high)),
      low: Math.min(...bars.map(b => b.low)),
      close: bars[bars.length - 1]!.close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
    })
  }
  return result
}

export function aggregateToWeekly(bars: BarInput[]): BarInput[] { return aggregateBars(bars, isoWeekKey, 'week') }
export function aggregateToMonthly(bars: BarInput[]): BarInput[] { return aggregateBars(bars, monthKey, 'month') }
export function aggregateToQuarterly(bars: BarInput[]): BarInput[] { return aggregateBars(bars, quarterKey, 'quarter') }
export function aggregateToYearly(bars: BarInput[]): BarInput[] { return aggregateBars(bars, yearKey, 'year') }

// ── Intraday (minute-based) aggregation ───────────────────────────────────────
// Groups 1-minute bars into N-minute candles using epoch-aligned bucket keys.

function minuteBucketKey(ts: number, minutes: number): number {
  const ms = minutes * 60_000
  return Math.floor(ts / ms) * ms
}

function aggregateMinuteBars(bars: BarInput[], minutes: number, timespan: string): BarInput[] {
  const buckets = new Map<number, BarInput[]>()
  for (const b of bars) {
    const key = minuteBucketKey(b.timestamp, minutes)
    const arr = buckets.get(key) ?? []
    arr.push(b)
    buckets.set(key, arr)
  }
  const result: BarInput[] = []
  for (const [key, group] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    result.push({
      ticker: group[0]!.ticker,
      timespan,
      timestamp: key,
      open: group[0]!.open,
      high: Math.max(...group.map(b => b.high)),
      low: Math.min(...group.map(b => b.low)),
      close: group[group.length - 1]!.close,
      volume: group.reduce((s, b) => s + b.volume, 0),
    })
  }
  return result
}

export function aggregateTo5min(bars: BarInput[]): BarInput[] { return aggregateMinuteBars(bars, 5, '5min') }
export function aggregateTo15min(bars: BarInput[]): BarInput[] { return aggregateMinuteBars(bars, 15, '15min') }
export function aggregateTo30min(bars: BarInput[]): BarInput[] { return aggregateMinuteBars(bars, 30, '30min') }
export function aggregateTo60min(bars: BarInput[]): BarInput[] { return aggregateMinuteBars(bars, 60, '60min') }

// ── MTF state ─────────────────────────────────────────────────────────────────

function tfDirection(bars: BarInput[]): MtfSignal {
  if (bars.length === 0) return 'up'
  const last = bars[bars.length - 1]!
  return last.close >= last.open ? 'up' : 'down'
}

export function computeMtfState(
  dailyBars: BarInput[],
  minuteBars?: BarInput[],
): MtfState {
  const sorted = [...dailyBars].sort((a, b) => a.timestamp - b.timestamp)
  const weekly    = aggregateToWeekly(sorted)
  const monthly   = aggregateToMonthly(sorted)
  const quarterly = aggregateToQuarterly(sorted)
  const yearly    = aggregateToYearly(sorted)

  const dDir = tfDirection(sorted)
  const wDir = tfDirection(weekly)
  const mDir = tfDirection(monthly)
  const qDir = tfDirection(quarterly)
  const yDir = tfDirection(yearly)

  // Intraday directions derived from 1min bars; fall back to daily direction if unavailable
  let dir1: MtfSignal = dDir
  let dir5: MtfSignal = dDir
  let dir15: MtfSignal = dDir
  let dir30: MtfSignal = dDir
  let dir60: MtfSignal = dDir

  if (minuteBars && minuteBars.length > 0) {
    const sortedMin = [...minuteBars].sort((a, b) => a.timestamp - b.timestamp)
    dir1  = tfDirection(sortedMin)
    dir5  = tfDirection(aggregateTo5min(sortedMin))
    dir15 = tfDirection(aggregateTo15min(sortedMin))
    dir30 = tfDirection(aggregateTo30min(sortedMin))
    dir60 = tfDirection(aggregateTo60min(sortedMin))
  }

  return {
    '1':  dir1,
    '5':  dir5,
    '15': dir15,
    '30': dir30,
    '60': dir60,
    D: dDir,
    W: wDir,
    M: mDir,
    Q: qDir,
    Y: yDir,
  }
}

// ── FTFC ──────────────────────────────────────────────────────────────────────

export function computeFTFC(mtf: MtfState): boolean {
  const vals = Object.values(mtf) as MtfSignal[]
  return vals.every(v => v === 'up') || vals.every(v => v === 'down')
}

// ── Full TA computation ───────────────────────────────────────────────────────

export interface TAResult {
  atrPct: number
  atrDollar: number
  avgVol30: number
  cc: string
  cc1: string
  cc2: string
  pattern: string
  signal: string
  category: ScannerCategory
  inForce: boolean
  ftfc: boolean
  mtf: MtfState
}

export function computeTA(
  bars: BarInput[],
  minuteBars?: BarInput[],
): TAResult {
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp)

  const { atrDollar, atrPct } = computeATR(sorted)
  const avgVol30 = computeAvgVol30(sorted)
  const codes = computeCcCodes(sorted)
  const pattern = computePattern(codes)
  const mtf = computeMtfState(sorted, minuteBars)
  const ftfc = computeFTFC(mtf)
  const signal = computeSignal(codes)
  const category = computeCategory(codes, ftfc)
  const inForce = computeInForce(sorted)

  return { atrPct, atrDollar, avgVol30, ...codes, pattern, signal, category, inForce, ftfc, mtf }
}

// ── Relative Volume ────────────────────────────────────────────────────────────

export function computeRVOL(todayVolume: number, avgVol: number): number {
  if (avgVol === 0) return 0
  return Math.round((todayVolume / avgVol) * 100) / 100
}

// ── Build a partial row from snapshot + TA ────────────────────────────────────

export function buildScannerRow(
  symbol: string,
  last: number,
  chgDollar: number,
  chgPct: number,
  ta: TAResult,
): Omit<ScannerRowTA, 'id'> {
  return { symbol, last, chgDollar, chgPct, sector: '', ...ta }
}
