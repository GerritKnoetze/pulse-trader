import { getOverview } from '../../services/data-manager.service';

export default defineEventHandler(() => {
  try {
    return { success: true, data: getOverview() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 500, message: msg });
  }
});
