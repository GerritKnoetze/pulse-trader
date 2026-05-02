import { getAggregates } from '../../services/market-data.service';

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event) as {
      ticker?: string;
      multiplier?: string;
      timespan?: string;
      from?: string;
      to?: string;
    };

    if (!query.ticker) {
      throw createError({ statusCode: 400, message: 'ticker is required' });
    }
    if (!query.from || !query.to) {
      throw createError({ statusCode: 400, message: 'from and to date parameters are required' });
    }

    const bars = await getAggregates(
      query.ticker,
      Number(query.multiplier) || 1,
      query.timespan || 'day',
      query.from,
      query.to,
    );

    return { success: true, data: bars, count: bars.length };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
