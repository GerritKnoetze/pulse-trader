/** A single OHLCV bar (candlestick) */
export interface Bar {
  ticker: string
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  transactions?: number
}

export type Timespan = 'minute' | 'hour' | 'day' | 'week' | 'month'

export interface AggregatesRequest {
  ticker: string
  multiplier: number
  timespan: Timespan
  from: string
  to: string
  adjusted?: boolean
  sort?: 'asc' | 'desc'
  limit?: number
}

export interface TickerResult {
  ticker: string
  name: string
  market: string
  locale: string
  type: string
  active: boolean
}

export interface DataSyncRequest {
  tickers: string[]
  from: string
  to: string
  timespan: Timespan
}

export interface DataSyncStatus {
  ticker: string
  timespan: Timespan
  oldestTimestamp: number | null
  newestTimestamp: number | null
  barCount: number
}

export interface MarketDataStatus {
  connected: boolean
  tickers: DataSyncStatus[]
  totalBars: number
}
