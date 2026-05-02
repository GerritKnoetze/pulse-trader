import { syncMarketData } from '../../services/market-data.service';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as {
      tickers?: string[];
      from?: string;
      to?: string;
      timespan?: string;
    };

    if (!body.tickers?.length) {
      throw createError({ statusCode: 400, message: 'tickers array is required' });
    }
    if (!body.from || !body.to) {
      throw createError({ statusCode: 400, message: 'from and to date parameters are required' });
    }

    const results = await syncMarketData(
      body.tickers,
      body.from,
      body.to,
      body.timespan || 'day',
    );

    return { success: true, data: results };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
