import { randomUUID } from 'crypto';
import { BaseRepository } from '../base-repository';
import { encrypt, decrypt, isSensitiveKey, maskValue } from '../../utils/encryption';

export interface Setting {
  Id: string;
  Key: string;
  Value: string | null;
  Type: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export type SettingType = 'string' | 'number' | 'boolean' | 'json';

export class SettingsRepository extends BaseRepository {
  findByKey(key: string): Setting | undefined {
    const results = this.executeQuery<Setting>(
      'SELECT * FROM Settings WHERE Key = @key',
      { key },
    );
    return results[0];
  }

  findById(id: string): Setting | undefined {
    const results = this.executeQuery<Setting>(
      'SELECT * FROM Settings WHERE Id = @id',
      { id },
    );
    return results[0];
  }

  listAll(): Setting[] {
    return this.executeQuery<Setting>('SELECT * FROM Settings ORDER BY Key');
  }

  listByType(type: SettingType): Setting[] {
    return this.executeQuery<Setting>(
      'SELECT * FROM Settings WHERE Type = @type ORDER BY Key',
      { type },
    );
  }

  /**
   * Upsert a setting by key.
   * Sensitive values (api-key, secret, etc.) are encrypted automatically.
   */
  setSetting(key: string, value: string | null, type: SettingType = 'string'): Setting {
    const now = new Date().toISOString();
    const storedValue = value !== null && value !== '' && isSensitiveKey(key) ? encrypt(value) : value;

    const existing = this.findByKey(key);
    if (existing) {
      this.executeRun(
        'UPDATE Settings SET Value = @value, Type = @type, UpdatedAt = @updatedAt WHERE Key = @key',
        { value: storedValue, type, updatedAt: now, key },
      );
      return { ...existing, Value: storedValue, Type: type, UpdatedAt: now };
    }

    const id = randomUUID();
    this.executeRun(
      'INSERT INTO Settings (Id, Key, Value, Type, CreatedAt, UpdatedAt) VALUES (@id, @key, @value, @type, @createdAt, @updatedAt)',
      { id, key, value: storedValue, type, createdAt: now, updatedAt: now },
    );
    return { Id: id, Key: key, Value: storedValue, Type: type, CreatedAt: now, UpdatedAt: now };
  }

  /**
   * Get a setting value, auto-decrypting sensitive keys.
   */
  getValue(key: string): string | null {
    const setting = this.findByKey(key);
    if (!setting || setting.Value === null) return null;

    if (isSensitiveKey(key)) {
      try {
        return decrypt(setting.Value);
      } catch {
        return setting.Value;
      }
    }
    return setting.Value;
  }

  /**
   * Get multiple settings as a key-value map.
   * Sensitive values are masked for API responses.
   */
  getSettingsMap(keys: string[], mask = false): Record<string, string | null> {
    const result: Record<string, string | null> = {};
    for (const key of keys) {
      const value = this.getValue(key);
      if (mask && value && isSensitiveKey(key)) {
        result[key] = maskValue(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  delete(id: string): boolean {
    const result = this.executeRun(
      'DELETE FROM Settings WHERE Id = @id',
      { id },
    );
    return result.changes > 0;
  }

  deleteByKey(key: string): boolean {
    const result = this.executeRun(
      'DELETE FROM Settings WHERE Key = @key',
      { key },
    );
    return result.changes > 0;
  }
}
