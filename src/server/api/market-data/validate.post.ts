import { validateConnection } from '../../services/market-data.service';

export default defineEventHandler(async () => {
  try {
    const result = await validateConnection();
    return { success: true, data: result };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
