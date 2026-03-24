interface SettingsResponse {
  success: boolean;
  data: Record<string, unknown>;
}

interface SaveResponse {
  success: boolean;
  saved: string[];
  rejected?: string[];
}

export function useSettings() {
  /**
   * Fetch all settings from the server.
   */
  async function getSettings(): Promise<Record<string, unknown>> {
    const res = await $fetch<SettingsResponse>('/api/settings');
    return res.data;
  }

  /**
   * Fetch a single setting value.
   */
  async function getSetting<T = string>(key: string): Promise<T | null> {
    const all = await getSettings();
    const raw = all[key];
    if (raw === null || raw === undefined) return null;
    return parseValue<T>(raw);
  }

  /**
   * Save one or more settings.
   */
  async function saveSettings(settings: Record<string, unknown>): Promise<SaveResponse> {
    return await $fetch<SaveResponse>('/api/settings', {
      method: 'POST',
      body: settings,
    });
  }

  /**
   * Save a single setting.
   */
  async function setSetting(key: string, value: unknown): Promise<SaveResponse> {
    return saveSettings({ [key]: value });
  }

  /**
   * Parse a raw string value into typed value.
   */
  function parseValue<T>(raw: string): T {
    if (raw === 'true') return true as T;
    if (raw === 'false') return false as T;
    if (!isNaN(Number(raw)) && raw.trim() !== '') return Number(raw) as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }

  return {
    getSettings,
    getSetting,
    saveSettings,
    setSetting,
    parseValue,
  };
}
