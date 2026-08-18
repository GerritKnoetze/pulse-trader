import { refreshCache } from '../../services/data-manager.service';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as { ticker?: string; timespan?: string };
    if (!body.ticker || !body.timespan) {
      throw createError({ statusCode: 400, message: 'ticker and timespan are required' });
    }
    const result = await refreshCache(body.ticker, body.timespan);
    return { success: true, data: result };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
