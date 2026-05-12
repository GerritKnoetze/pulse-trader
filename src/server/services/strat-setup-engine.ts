/**
 * Strat Setup Engine — Layer 1 (server service)
 *
 * Scores scanner rows against The Strat methodology and produces structured
 * StratSetup objects with entry/stop/target levels and quality grades.
 *
 * Quality grades:
 *   A+ = FTFC + premium combo + inForce + R:R ≥ 2
 *   A  = (FTFC OR premium combo) + inForce
 *   B  = basic combo, higher TFs not conflicted
 *   C  = pattern exists, higher TF conflicts
 */

import type { BarInput } from '../database/repositories/market-data-repository'
import type {
  ScannerRow,
  ScannerTimeframe,
  StratSetup,
  SetupQuality,
  TfContinuityStatus,
} from '../../app/types/scanner'

// ── Combo map: pattern string → combo metadata ────────────────────────────────

interface ComboInfo {
  combo:     string
  comboType: 'Reversal' | 'Continuation' | 'Reversal+' | 'Continuation+'
  direction: 'long' | 'short'
  isPremium: boolean
}

const COMBO_MAP: Record<string, Omit<ComboInfo, 'isPremium'>> = {
  // 3-bar patterns
  '2d-1-2u': { combo: '2-1-2 Bullish Reversal',     comboType: 'Reversal',     direction: 'long'  },
  '2u-1-2d': { combo: '2-1-2 Bearish Reversal',     comboType: 'Reversal',     direction: 'short' },
  '2u-1-2u': { combo: '2-1-2 Bullish Continuation', comboType: 'Continuation', direction: 'long'  },
  '2d-1-2d': { combo: '2-1-2 Bearish Continuation', comboType: 'Continuation', direction: 'short' },
  '3-1-2u':  { combo: '3-1-2 Bullish Reversal',     comboType: 'Reversal',     direction: 'long'  },
  '3-1-2d':  { combo: '3-1-2 Bearish Reversal',     comboType: 'Reversal',     direction: 'short' },
  '3-2d-2u': { combo: '3-2-2 Bullish Reversal',     comboType: 'Reversal',     direction: 'long'  },
  '3-2u-2d': { combo: '3-2-2 Bearish Reversal',     comboType: 'Reversal',     direction: 'short' },
  '1-2d-2u': { combo: '1-2-2 Bullish Reversal',     comboType: 'Reversal',     direction: 'long'  },
  '1-2u-2d': { combo: '1-2-2 Bearish Reversal',     comboType: 'Reversal',     direction: 'short' },
  // 2-bar patterns
  '2u-2u':   { combo: '2-2 Bullish Continuation',   comboType: 'Continuation', direction: 'long'  },
  '2d-2d':   { combo: '2-2 Bearish Continuation',   comboType: 'Continuation', direction: 'short' },
  '2d-2u':   { combo: '2-2 Bullish Reversal',       comboType: 'Reversal',     direction: 'long'  },
  '2u-2d':   { combo: '2-2 Bearish Reversal',       comboType: 'Reversal',     direction: 'short' },
}

const PREMIUM_COMBOS = new Set([
  '2-1-2 Bullish Reversal', '2-1-2 Bearish Reversal',
  '3-1-2 Bullish Reversal', '3-1-2 Bearish Reversal',
  '3-2-2 Bullish Reversal', '3-2-2 Bearish Reversal',
  '1-2-2 Bullish Reversal', '1-2-2 Bearish Reversal',
  '1-3 Bullish', '1-3 Bearish',
])

// ── TF hierarchy for continuity checks (day trading — capped at D) ──────────

// Valid signal timeframes for day trading (no daily/swing setups)
const INTRADAY_SIGNAL_TFS = new Set<ScannerTimeframe>(['1', '5', '15', '30', '60'])

// Continuity checks stop at D — W/M/Q/Y are not relevant for intraday traders
const TF_ORDER: ScannerTimeframe[] = ['1', '5', '15', '30', '60', 'D']

function getHigherTfs(signalTf: ScannerTimeframe): ScannerTimeframe[] {
  const idx = TF_ORDER.indexOf(signalTf)
  if (idx < 0 || idx >= TF_ORDER.length - 1) return []
  return TF_ORDER.slice(idx + 1)
}

// ── Resolve combo from pattern string ─────────────────────────────────────────

function resolveCombo(pattern: string, bars: BarInput[]): ComboInfo | null {
  const n = bars.length

  // 1-3 pattern: direction determined by close vs previous bar's extremes
  const parts = pattern.split('-')
  if (parts[parts.length - 1] === '3' && n >= 2) {
    const curr = bars[n - 1]!
    const prev = bars[n - 2]!
    if (curr.close > prev.high) {
      return { combo: '1-3 Bullish', comboType: 'Reversal+', direction: 'long',  isPremium: true }
    }
    if (curr.close < prev.low) {
      return { combo: '1-3 Bearish', comboType: 'Reversal+', direction: 'short', isPremium: true }
    }
    return null
  }

  const info = COMBO_MAP[pattern]
  if (!info) return null
  return { ...info, isPremium: PREMIUM_COMBOS.has(info.combo) }
}

// ── Entry / Stop / Target levels ──────────────────────────────────────────────
//
//  n-1 = current bar (entry candle — the bar that broke the signal)
//  n-2 = prior candle (signal bar whose high/low sets the entry price)
//  n-3, n-4, n-5 = target candles (prior highs/lows)

function computeLevels(
  direction: 'long' | 'short',
  bars: BarInput[],
): { entryPrice: number; stop: number; targets: number[] } | null {
  const n = bars.length
  if (n < 3) return null

  if (direction === 'long') {
    const entryPrice = bars[n - 2]!.high
    const stop       = bars[n - 1]!.low
    const targets: number[] = []
    if (n >= 4) targets.push(bars[n - 3]!.high)
    if (n >= 5) targets.push(bars[n - 4]!.high)
    if (n >= 6) targets.push(bars[n - 5]!.high)
    return { entryPrice, stop, targets }
  } else {
    const entryPrice = bars[n - 2]!.low
    const stop       = bars[n - 1]!.high
    const targets: number[] = []
    if (n >= 4) targets.push(bars[n - 3]!.low)
    if (n >= 5) targets.push(bars[n - 4]!.low)
    if (n >= 6) targets.push(bars[n - 5]!.low)
    return { entryPrice, stop, targets }
  }
}

// ── TF continuity ─────────────────────────────────────────────────────────────

function computeTfContinuity(
  direction: 'long' | 'short',
  mtf: ScannerRow['mtf'],
  signalTf: ScannerTimeframe,
): TfContinuityStatus {
  const higherTfs = getHigherTfs(signalTf)
  if (higherTfs.length === 0) return 'full'

  const expected = direction === 'long' ? 'up' : 'down'
  const dirs = higherTfs.map(tf => mtf[tf])

  if (dirs.every(d => d === expected))  return 'full'
  if (dirs.every(d => d !== expected))  return 'blocked'   // all higher TFs oppose the trade
  if (dirs[0] !== expected)             return 'conflicted' // immediate next TF opposes
  return 'partial'
}

// ── Quality grading ───────────────────────────────────────────────────────────

function gradeSetup(
  isPremium: boolean,
  ftfc: boolean,
  inForce: boolean,
  rr: number,
  tfContinuity: TfContinuityStatus,
): SetupQuality {
  if (ftfc && isPremium && inForce && rr >= 2) return 'A+'
  if ((ftfc || isPremium) && inForce)          return 'A'
  if (tfContinuity === 'full' || tfContinuity === 'partial') return 'B'
  return 'C'
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score a scanner row against The Strat methodology (intraday setups only).
 * Returns a StratSetup if a recognizable combo is found on the given intraday TF, null otherwise.
 *
 * @param row       The enriched ScannerRow (must have mtf, atrDollar, ftfc, inForce)
 * @param bars      Pre-aggregated bars for signalTf (e.g. 30M bars)
 * @param signalTf  The intraday timeframe the pattern was detected on ('5'|'15'|'30'|'60')
 * @param tfPattern The pattern string computed from the signalTf bars
 */
export function scoreSetup(
  row: ScannerRow,
  bars: BarInput[],
  signalTf: ScannerTimeframe,
  tfPattern: string,
): StratSetup | null {
  if (!INTRADAY_SIGNAL_TFS.has(signalTf)) return null
  if (!tfPattern || bars.length < 3) return null

  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp)

  const combo = resolveCombo(tfPattern, sorted)
  if (!combo) return null

  const levels = computeLevels(combo.direction, sorted)
  if (!levels) return null

  const { entryPrice, stop, targets } = levels

  const riskAmt = Math.abs(entryPrice - stop)
  if (riskAmt <= 0) return null

  const t1 = targets[0]
  const rr = t1 !== undefined
    ? Math.round((Math.abs(t1 - entryPrice) / riskAmt) * 100) / 100
    : 0

  const atrRisk = row.atrDollar > 0
    ? Math.round((riskAmt / row.atrDollar) * 100) / 100
    : 0

  const tfContinuity = computeTfContinuity(combo.direction, row.mtf, signalTf)
  const quality      = gradeSetup(combo.isPremium, row.ftfc, row.inForce, rr, tfContinuity)

  return {
    symbol:          row.symbol,
    signalTf,
    combo:           combo.combo,
    comboType:       combo.comboType,
    direction:       combo.direction,
    quality,
    entryPrice:      Math.round(entryPrice * 100) / 100,
    stop:            Math.round(stop * 100) / 100,
    targets:         targets.map(t => Math.round(t * 100) / 100),
    rr,
    atrRisk,
    tfContinuity,
    higherTfBlocked: tfContinuity === 'blocked',
    inForce:         row.inForce,
    ftfc:            row.ftfc,
    detectedAt:      new Date().toISOString(),
    alertSent:       false,
  }
}
