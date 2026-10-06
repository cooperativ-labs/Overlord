import type {
  AccountConnectionCredentialFormat,
  AccountConnectionProvider
} from '@overlord/contract';
import { createHash, hkdfSync } from 'node:crypto';

import { decodeEncryptionKey, openSecret, SecretEnvelopeError } from './crypto.ts';

/**
 * The account-connections key ring (contract v153). The current key
 * (`ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`, id `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID`,
 * default `k1`) seals every new credential. Two reserved ids keep the existing
 * personal-integration variables working: `everhour-env` opens adopted Everhour
 * envelopes and `github-user-env` adopted GitHub ones, and each is that provider's
 * write key when no current key is configured. No key ever leaves this module.
 *
 * Since v156 the ring also carries a **platform key**: when the deployment
 * provisions `BETTER_AUTH_SECRET` (every Cloud deployment does, and it is never
 * handled by a connecting user), a dedicated credential key is derived from it with
 * HKDF-SHA256 under an account-connections label. Its id, `platform-<fingerprint>`,
 * changes whenever the secret does, so a rotated secret is recognised as a rotated
 * key. The platform key seals new credentials only when no explicit current key is
 * configured (and, for a profile-scoped provider, no fallback key either); it stays
 * readable after an explicit key is added, so its rows are re-sealed lazily.
 */
export interface RingKey {
  id: string;
  key: Buffer;
}

export interface KeyRing {
  current: RingKey | null;
  /** Fallback key per profile-scoped provider; Knowledgebase has none. */
  fallback: Partial<Record<AccountConnectionProvider, RingKey>>;
  /** Derived from the deployment's `BETTER_AUTH_SECRET` (v156), or null when it is not set. */
  platform: RingKey | null;
}

export const EVERHOUR_ENV_KEY_ID = 'everhour-env';
export const GITHUB_USER_ENV_KEY_ID = 'github-user-env';
export const PLATFORM_KEY_ID_PREFIX = 'platform-';
const RESERVED_KEY_IDS = new Set([EVERHOUR_ENV_KEY_ID, GITHUB_USER_ENV_KEY_ID]);
/** Better Auth's own minimum; a shorter secret is not a credential-grade root. */
const MIN_PLATFORM_SECRET_LENGTH = 32;

export function isPlatformKeyId(id: string): boolean {
  return id.startsWith(PLATFORM_KEY_ID_PREFIX);
}

function isReservedKeyId(id: string): boolean {
  return RESERVED_KEY_IDS.has(id) || isPlatformKeyId(id);
}

/**
 * The platform key: HKDF-SHA256 over the deployment's auth secret with a label no
 * other component uses, so it is independent of every session or token signing
 * key derived from the same secret. The id carries a one-way fingerprint of the
 * derived key, never the key or the secret.
 */
export function platformKeyFromSecret(secret: string | undefined): RingKey | null {
  const trimmed = secret?.trim();
  if (!trimmed || trimmed.length < MIN_PLATFORM_SECRET_LENGTH) return null;
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(trimmed, 'utf8'),
      Buffer.from('overlord:account-connections', 'utf8'),
      Buffer.from('overlord:account-connections:platform-key:v1', 'utf8'),
      32
    )
  );
  const fingerprint = createHash('sha256')
    .update('overlord:account-connections:platform-key-id:v1:')
    .update(key)
    .digest('hex')
    .slice(0, 16);
  return { id: `${PLATFORM_KEY_ID_PREFIX}${fingerprint}`, key };
}

export function keyRingFromEnv(env: NodeJS.ProcessEnv): KeyRing {
  const currentKey = decodeEncryptionKey(env.ACCOUNT_CONNECTIONS_ENCRYPTION_KEY);
  const requestedId = env.ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID?.trim() || 'k1';
  if (currentKey && isReservedKeyId(requestedId))
    console.error(
      `[connections] ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID "${requestedId}" is reserved; using "k1"`
    );
  const currentId = isReservedKeyId(requestedId) ? 'k1' : requestedId;
  // Exactly the fallback order the Everhour extension used before v153.
  const everhour =
    decodeEncryptionKey(env.EVERHOUR_API_KEY_ENCRYPTION_KEY) ??
    decodeEncryptionKey(env.GITHUB_USER_TOKEN_ENCRYPTION_KEY);
  const github = decodeEncryptionKey(env.GITHUB_USER_TOKEN_ENCRYPTION_KEY);
  return {
    current: currentKey ? { id: currentId, key: currentKey } : null,
    fallback: {
      ...(everhour ? { everhour: { id: EVERHOUR_ENV_KEY_ID, key: everhour } } : {}),
      ...(github ? { github: { id: GITHUB_USER_ENV_KEY_ID, key: github } } : {})
    },
    platform: platformKeyFromSecret(env.BETTER_AUTH_SECRET)
  };
}

/**
 * The key new credentials for `provider` are sealed with, or null when none is
 * configured: the explicit current key, else the provider's fallback key (so an
 * existing personal-integration deployment keeps its key), else the platform key.
 */
export function writeKey(ring: KeyRing, provider: AccountConnectionProvider): RingKey | null {
  return ring.current ?? ring.fallback[provider] ?? ring.platform ?? null;
}

/** Where the write key comes from, for non-secret startup logging and docs. */
export function writeKeySource(
  ring: KeyRing,
  provider: AccountConnectionProvider
): 'explicit' | 'fallback' | 'platform' | null {
  if (ring.current) return 'explicit';
  if (ring.fallback[provider]) return 'fallback';
  return ring.platform ? 'platform' : null;
}

export function keyById(ring: KeyRing, id: string): RingKey | null {
  if (ring.current?.id === id) return ring.current;
  for (const entry of Object.values(ring.fallback)) if (entry?.id === id) return entry;
  if (ring.platform?.id === id) return ring.platform;
  return null;
}

/**
 * Whether a row whose key id is absent from the ring should be treated as a
 * missing configuration (answer `unavailable`, keep the envelope) rather than a
 * rotated key (erase and require reauthorization). Fallback ids and legacy
 * formats always count as missing configuration, and so does a deployment with
 * no current key at all: restoring the variable restores access. A platform key
 * id counts as missing configuration only while no platform key is derived at all
 * (`BETTER_AUTH_SECRET` unset); a different platform key means the secret was
 * rotated, which is a rotated key.
 */
export function missingKeyIsConfiguration(
  ring: KeyRing,
  keyId: string,
  format: AccountConnectionCredentialFormat
): boolean {
  if (isPlatformKeyId(keyId)) return ring.platform === null;
  return RESERVED_KEY_IDS.has(keyId) || format !== 'connection-v1' || ring.current === null;
}

export interface ConnectionCredentialRow {
  id: string | null;
  owner_profile_id: string;
  organization_id: string | null;
  provider: string;
  credential_format: string;
}

/** AAD for `connection-v1`: owner, organization (`-` when profile-scoped), provider, id. */
export function connectionCredentialAad(
  row: Pick<ConnectionCredentialRow, 'owner_profile_id' | 'organization_id' | 'provider' | 'id'>
): string {
  return `overlord:account-connection:v1:${row.owner_profile_id}:${row.organization_id ?? '-'}:${row.provider}:${row.id}`;
}

/** The plaintext an envelope carries, normalised across formats. */
export type OpenedCredential =
  | { kind: 'oauth'; accessToken: string; refreshToken: string | null }
  | { kind: 'api_key'; apiKey: string };

/**
 * Open a stored credential in any supported format. Throws `SecretEnvelopeError`
 * for a malformed envelope, wrong key, or wrong binding. Legacy formats bind only
 * the owner profile; the adopted row keeps that owner, so a copy on another
 * owner's row still fails authentication.
 */
export function openCredential(
  row: ConnectionCredentialRow & { credential_ciphertext: string },
  key: Buffer
): OpenedCredential {
  const format = row.credential_format as AccountConnectionCredentialFormat;
  if (format === 'everhour-user-key-v1') {
    const apiKey = openSecret({
      envelope: row.credential_ciphertext,
      key,
      aad: `overlord:everhour-user-key:v1:${row.owner_profile_id}:api-key`
    });
    return { kind: 'api_key', apiKey };
  }
  if (format === 'github-user-oauth-v1') {
    const parsed = parseJson(row.credential_ciphertext) as {
      access?: unknown;
      refresh?: unknown;
    } | null;
    if (!parsed || typeof parsed.access !== 'string') throw new SecretEnvelopeError();
    const aad = (purpose: string) =>
      `overlord:github-user-oauth:v1:${row.owner_profile_id}:${purpose}`;
    return {
      kind: 'oauth',
      accessToken: openSecret({ envelope: parsed.access, key, aad: aad('access') }),
      refreshToken:
        typeof parsed.refresh === 'string'
          ? openSecret({ envelope: parsed.refresh, key, aad: aad('refresh') })
          : null
    };
  }
  if (format !== 'connection-v1') throw new SecretEnvelopeError();
  const value = parseJson(
    openSecret({ envelope: row.credential_ciphertext, key, aad: connectionCredentialAad(row) })
  ) as { accessToken?: unknown; refreshToken?: unknown; apiKey?: unknown } | null;
  if (value && typeof value.apiKey === 'string') return { kind: 'api_key', apiKey: value.apiKey };
  if (value && typeof value.accessToken === 'string')
    return {
      kind: 'oauth',
      accessToken: value.accessToken,
      refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : null
    };
  throw new SecretEnvelopeError();
}

/** The `connection-v1` plaintext for a credential. */
export function credentialPlaintext(credential: OpenedCredential): string {
  return JSON.stringify(
    credential.kind === 'api_key'
      ? { apiKey: credential.apiKey }
      : { accessToken: credential.accessToken, refreshToken: credential.refreshToken }
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SecretEnvelopeError();
  }
}
