import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { ApiError } from '../../errors.ts';

function decodeEncryptionKey(encoded: string | undefined): Buffer | null {
  const trimmed = encoded?.trim();
  if (!trimmed) return null;
  const key = Buffer.from(trimmed, 'base64url');
  if (key.length !== 32) return null;
  return key;
}

/**
 * 32-byte AES key. Prefer the Everhour-specific variable; fall back to the
 * GitHub user-token key so existing deployments that already encrypt personal
 * integration secrets do not need a second secret to store Everhour keys.
 */
export function everhourEncryptionKeyFromEnv(): Buffer | null {
  return (
    decodeEncryptionKey(process.env.EVERHOUR_API_KEY_ENCRYPTION_KEY) ??
    decodeEncryptionKey(process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY)
  );
}

export function requireEverhourEncryptionKey(): Buffer {
  const key = everhourEncryptionKeyFromEnv();
  if (!key) {
    throw new ApiError(
      503,
      'Everhour API-key encryption is not configured on this Overlord server.'
    );
  }
  return key;
}

function apiKeyAad(profileId: string): Buffer {
  return Buffer.from(`overlord:everhour-user-key:v1:${profileId}:api-key`, 'utf8');
}

export function encryptEverhourApiKey({
  apiKey,
  profileId,
  key
}: {
  apiKey: string;
  profileId: string;
  key: Buffer;
}): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(apiKeyAad(profileId));
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${nonce.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptEverhourApiKey({
  envelope,
  profileId,
  key
}: {
  envelope: string;
  profileId: string;
  key: Buffer;
}): string {
  const [version, nonceText, tagText, ciphertextText, ...extra] = envelope.split('.');
  if (version !== 'v1' || !nonceText || !tagText || !ciphertextText || extra.length > 0) {
    throw new ApiError(503, 'The stored Everhour connection cannot be decrypted.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceText, 'base64url'));
    decipher.setAAD(apiKeyAad(profileId));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new ApiError(503, 'The stored Everhour connection cannot be decrypted.');
  }
}
