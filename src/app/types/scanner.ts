export type ScannerTimeframe = '1' | '5' | '15' | '30' | '60' | 'D' | 'W' | 'M' | 'Q' | 'Y'
export type ScannerMode = 'signal' | 'setup'
export type ScannerCategory = 'Continuation' | 'Continuation+' | 'Inside' | 'Reversal' | ''
export type MtfSignal = 'up' | 'down'
export interface MtfState { '1': MtfSignal; '5': MtfSignal; '15': MtfSignal; '30': MtfSignal; '60': MtfSignal; 'D': MtfSignal; 'W': MtfSignal; 'M': MtfSignal; 'Q': MtfSignal; 'Y': MtfSignal }

export type SetupQuality = 'A+' | 'A' | 'B' | 'C'
export type TfContinuityStatus = 'full' | 'partial' | 'conflicted' | 'blocked'

export interface StratSetup {
  symbol:          string
  signalTf:        ScannerTimeframe
  combo:           string
  comboType:       'Reversal' | 'Continuation' | 'Reversal+' | 'Continuation+'
  direction:       'long' | 'short'
  quality:         SetupQuality
  entryPrice:      number
  stop:            number
  targets:         number[]
  rr:              number
  atrRisk:         number
  tfContinuity:    TfContinuityStatus
  higherTfBlocked: boolean
  inForce:         boolean
  ftfc:            boolean
  detectedAt:      string
  alertSent:       boolean
}

/** Scan criteria sent to the server to filter the full-market snapshot */
export interface ScanCriteria {
  minPrice?:          number | undefined
  maxPrice?:          number | undefined
  minChangePercent?:  number | undefined
  maxChangePercent?:  number | undefined
  minVolume?:         number | undefined
  minRvol?:           number | undefined
}

export interface ScannerRow {
  id: string
  symbol: string
  atrPct: number
  last: number
  sector: string
  category: ScannerCategory
  signal: string
  pattern: string
  cc2: string
  cc1: string
  cc: string
  avgVol30: number
  rvol: number
  inForce: boolean
  ftfc: boolean
  chgDollar: number
  chgPct: number
  atrDollar: number
  mtf: MtfState
  setup?: StratSetup
  /** Data readiness of the row: 'none' = snapshot only, 'daily' = bars but no
   *  intraday, 'full' = daily + intraday TA computed, 'error' = fetch was
   *  rate-limited / failed. */
  enrichLevel?: 'none' | 'daily' | 'full' | 'error'
  /** True when the symbol is currently streamed by the live WebSocket relay. */
  wsActive?: boolean
}

export type SortDirection = 'asc' | 'desc' | null

export interface ScannerColumnDef {
  key: keyof ScannerRow
  label: string
  width: string
  align?: 'left' | 'right' | 'center'
  sortable: boolean
  visible: boolean
}

export interface QuickFilter {
  id: string
  label: string
  isCustom?: boolean
}
