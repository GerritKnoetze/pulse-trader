import { getRows } from '../../services/data-manager.service';

export default defineEventHandler((event) => {
  try {
    const query = getQuery(event) as {
      ticker?: string;
      timespan?: string;
      source?: 'cache' | 'db';
      from?: string;
      to?: string;
      limit?: string;
    };
    if (!query.ticker || !query.timespan) {
      throw createError({ statusCode: 400, message: 'ticker and timespan are required' });
    }
    const rows = getRows(query.ticker, query.timespan, {
      source: query.source ?? 'db',
      from: query.from ? Number(query.from) : undefined,
      to: query.to ? Number(query.to) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return { success: true, data: rows, count: rows.length };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
