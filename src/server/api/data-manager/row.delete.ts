import { deleteBar, deleteBatch } from '../../services/data-manager.service';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as {
      id?: string;
      ticker?: string;
      timespan?: string;
      timestamp?: number;
      batchDate?: string;
    };

    // Batch delete: remove every bar of a series on a given ET date.
    if (body.batchDate && body.ticker && body.timespan) {
      const result = deleteBatch(body.ticker, body.timespan, body.batchDate);
      return { success: true, data: result };
    }

    if (!body.ticker || !body.timespan) {
      throw createError({ statusCode: 400, message: 'ticker and timespan are required' });
    }
    if (!body.id && body.timestamp === undefined) {
      throw createError({ statusCode: 400, message: 'id or timestamp is required' });
    }

    const result = deleteBar({
      id: body.id,
      ticker: body.ticker,
      timespan: body.timespan,
      timestamp: body.timestamp,
    });
    if (!result.ok) {
      throw createError({ statusCode: 404, message: 'Bar not found' });
    }
    return { success: true, data: result };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
