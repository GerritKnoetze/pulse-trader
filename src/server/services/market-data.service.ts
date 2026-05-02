import { restClient } from '@massive.com/client-js';
import { SettingsRepository } from '../database/repositories/settings-repository';
import { MarketDataRepository } from '../database/repositories/market-data-repository';
import type { BarInput } from '../database/repositories/market-data-repository';
import { decryptJsonFields } from '../utils/encryption';

interface MassiveBar {
  t?: number;  // timestamp (ms)
  o?: number;  // open
  h?: number;  // high
  l?: number;  // low
  c?: number;  // close
  v?: number;  // volume
  n?: number;  // transactions
}

interface MassiveAggResponse {
  status?: string;
  results?: MassiveBar[];
  resultsCount?: number;
  next_url?: string;
  data?: {
    results?: MassiveBar[];
    resultsCount?: number;
    status?: string;
    next_url?: string;
  };
}

interface MassiveTickerResult {
  ticker?: string;
  name?: string;
  market?: string;
  locale?: string;
  type?: string;
  active?: boolean;
}

interface MassiveTickerResponse {
  status?: string;
  results?: MassiveTickerResult[];
  data?: {
    results?: MassiveTickerResult[];
    status?: string;
  };
}

function getDecryptedBrokerDetails(): { apiKey: string; apiUrl: string } {
  const settingsRepo = new SettingsRepository();
  const raw = settingsRepo.getValue('data-broker-details');
  if (!raw) {
    throw new Error('Data broker not configured. Please set your Massive.com API key in Settings.');
  }

  const details = JSON.parse(raw);
  const decrypted = decryptJsonFields('data-broker-details', details);

  if (!decrypted.apiKey) {
    throw new Error('Massive.com API key not configured. Please set it in Settings > Data Provider.');
  }

  return {
    apiKey: decrypted.apiKey as string,
    apiUrl: (decrypted.apiUrl as string) || 'https://api.massive.com',
  };
}

function createClient() {
  const { apiKey, apiUrl } = getDecryptedBrokerDetails();
  return restClient(apiKey, apiUrl);
}

/**
 * Validate the Massive.com API connection by making a simple request.
 */
export async function validateConnection(): Promise<{ valid: boolean; message: string }> {
  try {
    const client = createClient();
    const response = await client.getStocksAggregates({
      stocksTicker: 'AAPL',
      multiplier: '1',
      timespan: 'day',
      from: '2025-01-02',
      to: '2025-01-02',
      limit: '1',
    });

    const aggResponse = response as MassiveAggResponse;
    const status = aggResponse?.status ?? aggResponse?.data?.status;
    if (status === 'OK') {
      return { valid: true, message: 'Connection successful' };
    }
    return { valid: false, message: `Unexpected response status: ${status}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { valid: false, message: `Connection failed: ${msg}` };
  }
}

function mapBar(ticker: string, timespan: string, bar: MassiveBar): BarInput {
  return {
    ticker,
    timespan,
    timestamp: bar.t ?? 0,
    open: bar.o ?? 0,
    high: bar.h ?? 0,
    low: bar.l ?? 0,
    close: bar.c ?? 0,
    volume: bar.v ?? 0,
    transactions: bar.n,
  };
}

/**
 * Fetch aggregate bars from Massive.com and cache them locally.
 * Follows pagination (next_url) to retrieve all bars in the date range.
 */
export async function fetchAggregates(
  ticker: string,
  multiplier: number,
  timespan: string,
  from: string,
  to: string,
): Promise<BarInput[]> {
  const { apiKey } = getDecryptedBrokerDetails();
  const client = createClient();

  const allBars: BarInput[] = [];
  let nextUrl: string | undefined;

  // First request via client
  try {
    const response = await client.getStocksAggregates({
      stocksTicker: ticker,
      multiplier: String(multiplier),
      timespan,
      from,
      to,
      adjusted: 'true',
      sort: 'asc',
      limit: '50000',
    }) as MassiveAggResponse;

    const results = response?.results ?? response?.data?.results ?? [];
    allBars.push(...results.map((bar: MassiveBar) => mapBar(ticker, timespan, bar)));
    nextUrl = response?.next_url ?? response?.data?.next_url;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Massive.com API error for ${ticker}: ${msg}`);
  }

  // Follow pagination via next_url
  while (nextUrl) {
    try {
      const separator = nextUrl.includes('?') ? '&' : '?';
      const paginatedUrl = nextUrl.includes('apiKey')
        ? nextUrl
        : `${nextUrl}${separator}apiKey=${encodeURIComponent(apiKey)}`;
      const res = await fetch(paginatedUrl);
      if (!res.ok) break;
      const data = (await res.json()) as MassiveAggResponse;
      const results = data?.results ?? [];
      if (results.length === 0) break;
      allBars.push(...results.map((bar: MassiveBar) => mapBar(ticker, timespan, bar)));
      nextUrl = data?.next_url;
    } catch {
      break;
    }
  }

  return allBars;
}

/**
 * Fetch and cache bars, returning from cache if already present.
 */
export async function getAggregates(
  ticker: string,
  multiplier: number,
  timespan: string,
  from: string,
  to: string,
): Promise<BarInput[]> {
  const repo = new MarketDataRepository();

  // Convert date strings to timestamps for cache lookup
  const fromTs = new Date(from).getTime();
  const toTs = new Date(to).getTime();

  // Check cache first
  const cached = repo.getBars(ticker, timespan, fromTs, toTs);
  if (cached.length > 0) {
    return cached.map(row => ({
      ticker: row.Ticker,
      timespan: row.Timespan,
      timestamp: row.Timestamp,
      open: row.Open,
      high: row.High,
      low: row.Low,
      close: row.Close,
      volume: row.Volume,
      transactions: row.Transactions ?? undefined,
    }));
  }

  // Fetch from API
  const bars = await fetchAggregates(ticker, multiplier, timespan, from, to);

  // Cache the results
  if (bars.length > 0) {
    repo.upsertBars(bars);
  }

  return bars;
}

/**
 * Sync market data for multiple tickers over a date range.
 */
export async function syncMarketData(
  tickers: string[],
  from: string,
  to: string,
  timespan: string = 'minute',
): Promise<{ ticker: string; bars: number; error?: string }[]> {
  const results: { ticker: string; bars: number; error?: string }[] = [];
  const repo = new MarketDataRepository();

  for (const ticker of tickers) {
    try {
      const bars = await fetchAggregates(ticker, 1, timespan, from, to);
      if (bars.length > 0) {
        repo.upsertBars(bars);
      }
      results.push({ ticker, bars: bars.length });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push({ ticker, bars: 0, error: msg });
    }
  }

  return results;
}

/**
 * Search for tickers matching a query.
 */
export async function searchTickers(query: string): Promise<MassiveTickerResult[]> {
  const client = createClient();
  const response = await client.getReferenceTickersV3({
    search: query,
    active: 'true',
    market: 'stocks',
    limit: '20',
  }) as MassiveTickerResponse;

  return response?.results ?? response?.data?.results ?? [];
}

/**
 * Get the status of cached market data.
 */
export function getMarketDataStatus() {
  const repo = new MarketDataRepository();
  return {
    tickers: repo.getDataStatus(),
    totalBars: repo.getTotalBars(),
  };
}
