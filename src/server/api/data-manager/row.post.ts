import { upsertBar, type BarInputWithId } from '../../services/data-manager.service';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as Partial<BarInputWithId>;
    if (!body.ticker || !body.timespan) {
      throw createError({ statusCode: 400, message: 'ticker and timespan are required' });
    }
    if (typeof body.timestamp !== 'number' || !Number.isFinite(body.timestamp)) {
      throw createError({ statusCode: 400, message: 'valid timestamp is required' });
    }
    const result = upsertBar({
      id: body.id,
      ticker: body.ticker,
      timespan: body.timespan,
      timestamp: body.timestamp,
      open: body.open ?? 0,
      high: body.high ?? 0,
      low: body.low ?? 0,
      close: body.close ?? 0,
      volume: body.volume ?? 0,
      transactions: body.transactions,
    });
    return { success: true, data: result };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
