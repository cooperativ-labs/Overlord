import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Shared AES-256-GCM secret envelopes for account connections and the
 * profile-scoped integration stores (Everhour, GitHub). The envelope format is
 * `v1.<nonce>.<tag>.<ciphertext>` (base64url), unchanged from the stores that
 * already use it, so existing rows decrypt without migration. The additional
 * authenticated data binds an envelope to its owner and purpose: a ciphertext
 * copied to another owner's row fails authentication.
 */
export class SecretEnvelopeError extends Error {
  constructor() {
    super('The stored secret cannot be decrypted.');
  }
}

/** Decode a 32-byte base64url key from configuration, or null when absent or malformed. */
export function decodeEncryptionKey(encoded: string | undefined): Buffer | null {
  const trimmed = encoded?.trim();
  if (!trimmed) return null;
  const key = Buffer.from(trimmed, 'base64url');
  return key.length === 32 ? key : null;
}

export function sealSecret({
  plaintext,
  key,
  aad
}: {
  plaintext: string;
  key: Buffer;
  aad: string;
}): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${nonce.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

/** Throws `SecretEnvelopeError` for a malformed envelope, wrong key, or wrong binding. */
export function openSecret({
  envelope,
  key,
  aad
}: {
  envelope: string;
  key: Buffer;
  aad: string;
}): string {
  const [version, nonceText, tagText, ciphertextText, ...extra] = envelope.split('.');
  if (version !== 'v1' || !nonceText || !tagText || !ciphertextText || extra.length > 0) {
    throw new SecretEnvelopeError();
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceText, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new SecretEnvelopeError();
  }
}

/** One-way hash for single-use OAuth `state` lookups; the raw value is never stored. */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
