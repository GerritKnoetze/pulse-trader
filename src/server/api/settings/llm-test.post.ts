import { defineEventHandler, createError } from 'h3';
import { chat } from '../../services/llm.service';

export default defineEventHandler(async () => {
  try {
    const start = Date.now();
    const response = await chat(
      [
        { role: 'system', content: 'You are a helpful assistant. Respond in one short sentence.' },
        { role: 'user', content: 'Say "Connection successful" and name the model you are.' },
      ],
      { temperature: 0, maxTokens: 100 },
    );
    const elapsed = Date.now() - start;

    return {
      success: true,
      data: {
        response: response.trim(),
        latencyMs: elapsed,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createError({ statusCode: 502, message });
  }
});
