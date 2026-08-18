import { flushDb } from '../../services/data-manager.service';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as {
      all?: boolean;
      ticker?: string;
      timespan?: string;
      confirm?: string;
    };

    if (body.all && body.confirm !== 'flush-all') {
      throw createError({ statusCode: 400, message: 'Full DB flush requires confirm: "flush-all"' });
    }
    if (!body.all && !body.ticker) {
      throw createError({ statusCode: 400, message: 'ticker is required (or all: true) ' });
    }

    const result = flushDb({ all: body.all, ticker: body.ticker, timespan: body.timespan });
    return { success: true, data: result };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
