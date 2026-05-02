import { MarketDataRepository } from '../../database/repositories/market-data-repository';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as {
      ticker?: string;
      timespan?: string;
    };

    if (!body.ticker) {
      throw createError({ statusCode: 400, message: 'ticker is required' });
    }

    const repo = new MarketDataRepository();
    const deleted = repo.deleteByTicker(body.ticker, body.timespan);

    return { success: true, deleted };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
