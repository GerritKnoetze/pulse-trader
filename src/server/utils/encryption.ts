import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'pulse-trader-salt';

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || 'pulse-trader-default-key-change-me';
  return scryptSync(secret, SALT, 32);
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted value format');

  const [ivHex, tagHex, encrypted] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
  return decrypted;
}

export function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return value.substring(0, 4) + '••••' + value.substring(value.length - 4);
}

/** Check if a setting key contains sensitive data */
export function isSensitiveKey(key: string): boolean {
  const sensitivePatterns = ['api-key', 'secret', 'password', 'token'];
  return sensitivePatterns.some(p => key.toLowerCase().includes(p));
}

/** Sub-fields within JSON settings that contain sensitive data */
const SENSITIVE_JSON_SUBFIELDS: Record<string, string[]> = {
  'data-broker-details': ['apiKey'],
  'trading-broker-details': ['liveApiKeyId', 'liveApiKeySecret', 'paperApiKeyId', 'paperApiKeySecret'],
  'llm-details': ['apiKey'],
};

/** Check if a value looks like it's already in our encrypted format (hex:hex:hex) */
function isEncryptedFormat(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [iv, tag, data] = parts as [string, string, string];
  // IV is 16 bytes = 32 hex chars, tag is 16 bytes = 32 hex chars, data is non-empty hex
  return iv.length === 32 && tag.length === 32 && data.length > 0
    && /^[0-9a-f]+$/.test(iv) && /^[0-9a-f]+$/.test(tag) && /^[0-9a-f]+$/.test(data);
}

/** Encrypt only sensitive sub-fields in a JSON setting before storage */
export function encryptJsonFields(key: string, obj: Record<string, unknown>): Record<string, unknown> {
  const fields = SENSITIVE_JSON_SUBFIELDS[key];
  if (!fields) return obj;
  const result = { ...obj };
  for (const field of fields) {
    if (typeof result[field] === 'string' && result[field]) {
      // Skip fields that are already encrypted (preserved from DB during merge)
      if (isEncryptedFormat(result[field] as string)) continue;
      result[field] = encrypt(result[field] as string);
    }
  }
  return result;
}

/** Decrypt only sensitive sub-fields in a JSON setting after retrieval */
export function decryptJsonFields(key: string, obj: Record<string, unknown>): Record<string, unknown> {
  const fields = SENSITIVE_JSON_SUBFIELDS[key];
  if (!fields) return obj;
  const result = { ...obj };
  for (const field of fields) {
    if (typeof result[field] === 'string' && result[field]) {
      try {
        result[field] = decrypt(result[field] as string);
      } catch {
        // Already plaintext or corrupted — leave as-is
      }
    }
  }
  return result;
}

/** Mask sensitive sub-fields in a parsed JSON setting */
export function maskJsonFields(key: string, obj: Record<string, unknown>): Record<string, unknown> {
  const fields = SENSITIVE_JSON_SUBFIELDS[key];
  if (!fields) return obj;
  const masked = { ...obj };
  for (const field of fields) {
    if (typeof masked[field] === 'string' && masked[field]) {
      masked[field] = maskValue(masked[field] as string);
    }
  }
  return masked;
}

function isMaskedValue(value: string): boolean {
  return value.includes('\u2022\u2022\u2022\u2022');
}

/** Merge incoming JSON with existing encrypted values, preserving unchanged masked secrets */
export function mergeJsonWithExisting(
  key: string,
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const fields = SENSITIVE_JSON_SUBFIELDS[key] ?? [];
  // Base on existing so un-touched keys survive; overlay incoming changes on top
  const merged = { ...existing, ...incoming };
  // If a sensitive field came in as a masked value the user didn't touch, keep the stored encrypted value
  for (const field of fields) {
    const val = incoming[field];
    if (typeof val === 'string' && isMaskedValue(val)) {
      merged[field] = existing[field];
    }
  }
  return merged;
}
