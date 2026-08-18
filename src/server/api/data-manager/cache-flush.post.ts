import { flushCache } from '../../services/data-manager.service';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as {
      scope?: 'candles' | 'snapshot' | 'rows' | 'all';
      ticker?: string;
      timespan?: string;
    };
    const result = flushCache({
      scope: body.scope ?? 'candles',
      ticker: body.ticker,
      timespan: body.timespan,
    });
    return { success: true, data: result };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
