export function useMarketData() {
  async function searchTickers(query: string) {
    if (!query || query.length < 1) return [];
    const res = await $fetch<{ success: boolean; data: { ticker: string; name: string; type: string; active: boolean }[] }>(
      `/api/market-data/tickers?search=${encodeURIComponent(query)}`,
    );
    return res.data ?? [];
  }

  async function getDataStatus() {
    const res = await $fetch<{
      success: boolean;
      data: {
        tickers: { ticker: string; timespan: string; count: number; minTs: number; maxTs: number }[];
        totalBars: number;
      };
    }>('/api/market-data/status');
    return res.data;
  }

  async function syncData(tickers: string[], from: string, to: string, timespan: string = 'day') {
    return await $fetch<{
      success: boolean;
      data: { ticker: string; bars: number; error?: string }[];
    }>('/api/market-data/sync', {
      method: 'POST',
      body: { tickers, from, to, timespan },
    });
  }

  async function validateConnection() {
    const res = await $fetch<{
      success: boolean;
      data: { valid: boolean; message: string };
    }>('/api/market-data/validate', {
      method: 'POST',
    });
    return res.data;
  }

  async function getAggregates(ticker: string, from: string, to: string, timespan: string = 'day') {
    const res = await $fetch<{
      success: boolean;
      data: { ticker: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }[];
      count: number;
    }>(`/api/market-data/aggregates?ticker=${encodeURIComponent(ticker)}&from=${from}&to=${to}&timespan=${timespan}`);
    return res.data ?? [];
  }

  async function deleteData(ticker: string, timespan?: string) {
    return await $fetch<{ success: boolean; deleted: number }>('/api/market-data/delete', {
      method: 'POST',
      body: { ticker, timespan },
    });
  }

  return {
    searchTickers,
    getDataStatus,
    syncData,
    validateConnection,
    getAggregates,
    deleteData,
  };
}
