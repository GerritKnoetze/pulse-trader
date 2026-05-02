import { SettingsRepository, type SettingType } from '../../database/repositories/settings-repository';
import { mergeJsonWithExisting, encryptJsonFields } from '../../utils/encryption';

/** Allowed setting keys for validation */
const ALLOWED_KEYS = new Set([
  // Trading
  'local-currency',
  'default-position-size',
  'risk-per-trade',
  'confirm-trades',
  // Data provider
  'active-data-broker',
  'data-broker-details',
  // Trading broker
  'active-trading-broker',
  'trading-broker-details',
  // LLM / AI
  'llm-provider',
  'llm-details',
]);

/** Keys that store JSON with sensitive sub-fields requiring merge */
const JSON_SETTINGS = new Set(['data-broker-details', 'trading-broker-details', 'llm-details']);

function detectType(value: unknown): SettingType {
  if (typeof value === 'boolean' || value === 'true' || value === 'false') return 'boolean';
  if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '')) return 'number';
  if (typeof value === 'object') return 'json';
  return 'string';
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Request body must be a JSON object' });
  }

  try {
    const repo = new SettingsRepository();
    const saved: string[] = [];
    const rejected: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      rejected.push(key);
      continue;
    }

    if (JSON_SETTINGS.has(key)) {
      if (typeof value !== 'object' || value === null) {
        rejected.push(key);
        continue;
      }
      const existingRaw = repo.findByKey(key)?.Value;
      let existing: Record<string, unknown> = {};
      if (existingRaw) {
        try { existing = JSON.parse(existingRaw); } catch { /* ignore */ }
      }
      const merged = mergeJsonWithExisting(key, value as Record<string, unknown>, existing);
      const encrypted = encryptJsonFields(key, merged);
      repo.setSetting(key, JSON.stringify(encrypted), 'json');
      saved.push(key);
      continue;
    }

    const strValue = value === null ? null : String(value);
    const type = detectType(value);
    repo.setSetting(key, strValue, type);
    saved.push(key);
  }

    return {
      success: true,
      saved,
      ...(rejected.length > 0 && { rejected }),
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('no such table')) {
      throw createError({ statusCode: 503, statusMessage: 'Database not initialized. Run migrations first.' });
    }
    throw error;
  }
});
