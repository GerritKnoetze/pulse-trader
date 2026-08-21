import { SettingsRepository } from '../../database/repositories/settings-repository';
import { maskValue, isSensitiveKey, decryptJsonFields, maskJsonFields } from '../../utils/encryption';

/** All known settings keys used by the application */
const SETTINGS_KEYS = [
  // Trading
  'local-currency',
  'default-position-size',
  'risk-per-trade',
  'confirm-trades',
  'debug-mode',
  // Data provider
  'active-data-broker',
  'data-broker-details',
  // Data retention
  'intraday-window-calendar-days',
  'daily-lookback-calendar-days',
  'ten-second-lookback-minutes',
  'ten-second-prune-hours',
  // Trading broker
  'active-trading-broker',
  'trading-broker-details',
  // LLM / AI
  'llm-provider',
  'llm-details',
];

/** Keys that store JSON with sub-fields requiring masking */
const JSON_SETTINGS = new Set(['data-broker-details', 'trading-broker-details', 'llm-details']);

export default defineEventHandler(async (event) => {
  try {
    const repo = new SettingsRepository();

    const data: Record<string, unknown> = {};
    for (const key of SETTINGS_KEYS) {
      const value = repo.getValue(key);
      if (value === null) {
        data[key] = null;
        continue;
      }
      if (JSON_SETTINGS.has(key)) {
        try {
          const parsed = JSON.parse(value);
          const decrypted = decryptJsonFields(key, parsed);
          data[key] = maskJsonFields(key, decrypted);
        } catch {
          data[key] = value;
        }
        continue;
      }
      if (isSensitiveKey(key)) {
        data[key] = maskValue(value);
      } else {
        data[key] = value;
      }
    }

    return { success: true, data };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('no such table')) {
      const data: Record<string, unknown> = {};
      for (const key of SETTINGS_KEYS) {
        data[key] = null;
      }
      return { success: true, data, migrationRequired: true };
    }
    throw error;
  }
});
