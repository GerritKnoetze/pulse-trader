import { defineEventHandler } from 'h3';
import { SettingsRepository } from '../../database/repositories/settings-repository';
import { decryptJsonFields } from '../../utils/encryption';

export interface GithubModel {
  id: string;
  name: string;
  friendly_name?: string;
  publisher?: string;
  context_length?: number;
  task?: string;
  rate_limit_tier?: string;
  rate_limit_multiplier?: number;
  request_multiplier?: number;
  model_limit_multiplier?: number;
  limit_multiplier?: number;
  [key: string]: unknown;
}

// GET /api/settings/llm-models — fetch available models from GitHub Models API
export default defineEventHandler(async () => {
  try {
    const repo = new SettingsRepository();
    const detailsRaw = repo.getValue('llm-details');
    if (!detailsRaw) {
      return { success: true, data: [], message: 'No LLM settings configured' };
    }

    let details: Record<string, unknown>;
    try {
      details = JSON.parse(detailsRaw);
    } catch {
      return { success: true, data: [], message: 'LLM settings corrupted' };
    }

    const decrypted = decryptJsonFields('llm-details', details);
    const apiKey = decrypted.apiKey as string;
    if (!apiKey || apiKey.includes('••••')) {
      return { success: true, data: [], message: 'No API key configured' };
    }

    const apiUrl = (decrypted.apiUrl as string) || 'https://models.inference.ai.azure.com';

    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return { success: true, data: [], message: 'Could not fetch models from API' };
    }

    const raw = await response.json();
    const models: GithubModel[] = Array.isArray(raw) ? raw : (raw?.data ?? []);

    return { success: true, data: models };
  } catch {
    return { success: true, data: [], message: 'Failed to fetch model list' };
  }
});
