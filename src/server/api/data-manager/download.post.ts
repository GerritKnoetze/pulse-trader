import { downloadHistory } from '../../services/data-manager.service';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as {
      tickers?: string[];
      timespan?: string;
      multiplier?: number;
      from?: string;
      to?: string;
    };

    if (!body.tickers?.length) {
      throw createError({ statusCode: 400, message: 'tickers array is required' });
    }
    if (!body.from || !body.to) {
      throw createError({ statusCode: 400, message: 'from and to dates are required' });
    }

    const results = await downloadHistory({
      tickers: body.tickers,
      timespan: body.timespan || 'day',
      multiplier: body.multiplier || 1,
      from: body.from,
      to: body.to,
    });

    return { success: true, data: results };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
