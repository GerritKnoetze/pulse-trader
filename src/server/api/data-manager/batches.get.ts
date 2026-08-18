import { getBatches } from '../../services/data-manager.service';

export default defineEventHandler((event) => {
  try {
    const query = getQuery(event) as { ticker?: string; timespan?: string };
    if (!query.ticker || !query.timespan) {
      throw createError({ statusCode: 400, message: 'ticker and timespan are required' });
    }
    return { success: true, data: getBatches(query.ticker, query.timespan) };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
