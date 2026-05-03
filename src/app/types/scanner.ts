export type ScannerTimeframe = '15' | '30' | '60' | 'D' | 'W' | 'M' | 'Q' | 'Y'
export type ScannerMode = 'signal' | 'setup'
export type ScannerCategory = 'Continuation' | 'Continuation+' | 'Inside' | 'Reversal' | ''
export type MtfSignal = 'up' | 'down'
export interface MtfState { '15': MtfSignal; '30': MtfSignal; '60': MtfSignal; 'D': MtfSignal; 'W': MtfSignal; 'Q': MtfSignal; 'Y': MtfSignal }

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
  inForce: boolean
  ftfc: boolean
  chgDollar: number
  chgPct: number
  atrDollar: number
  mtf: MtfState
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
