import { searchTickers } from '../../services/market-data.service';

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event) as { search?: string };

    if (!query.search || query.search.length < 1) {
      return { success: true, data: [] };
    }

    const results = await searchTickers(query.search);
    return { success: true, data: results };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
