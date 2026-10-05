import { decodeEncryptionKey, openSecret, sealSecret } from '../../connections/crypto.ts';
import { ApiError } from '../../errors.ts';

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

function apiKeyAad(profileId: string): string {
  return `overlord:everhour-user-key:v1:${profileId}:api-key`;
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
  return sealSecret({ plaintext: apiKey, key, aad: apiKeyAad(profileId) });
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
  try {
    return openSecret({ envelope, key, aad: apiKeyAad(profileId) });
  } catch {
    throw new ApiError(503, 'The stored Everhour connection cannot be decrypted.');
  }
}
