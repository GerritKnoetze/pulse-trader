import { getMarketDataStatus } from '../../services/market-data.service';

export default defineEventHandler(() => {
  try {
    const status = getMarketDataStatus();
    return { success: true, data: status };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('no such table')) {
      return { success: true, data: { tickers: [], totalBars: 0 }, migrationRequired: true };
    }
    throw createError({ statusCode: 500, message: msg });
  }
});
