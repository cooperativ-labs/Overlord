import type {
  AccountConnectionCredentialFormat,
  AccountConnectionProvider
} from '@overlord/contract';

import { decodeEncryptionKey, openSecret, SecretEnvelopeError } from './crypto.ts';

/**
 * The account-connections key ring (contract v153). The current key
 * (`ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`, id `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID`,
 * default `k1`) seals every new credential. Two reserved ids keep the existing
 * personal-integration variables working: `everhour-env` opens adopted Everhour
 * envelopes and `github-user-env` adopted GitHub ones, and each is that provider's
 * write key when no current key is configured. No key ever leaves this module.
 */
export interface RingKey {
  id: string;
  key: Buffer;
}

export interface KeyRing {
  current: RingKey | null;
  /** Fallback key per profile-scoped provider; Knowledgebase has none. */
  fallback: Partial<Record<AccountConnectionProvider, RingKey>>;
}

export const EVERHOUR_ENV_KEY_ID = 'everhour-env';
export const GITHUB_USER_ENV_KEY_ID = 'github-user-env';
const RESERVED_KEY_IDS = new Set([EVERHOUR_ENV_KEY_ID, GITHUB_USER_ENV_KEY_ID]);

export function keyRingFromEnv(env: NodeJS.ProcessEnv): KeyRing {
  const currentKey = decodeEncryptionKey(env.ACCOUNT_CONNECTIONS_ENCRYPTION_KEY);
  const requestedId = env.ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID?.trim() || 'k1';
  if (currentKey && RESERVED_KEY_IDS.has(requestedId))
    console.error(
      `[connections] ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID "${requestedId}" is reserved; using "k1"`
    );
  const currentId = RESERVED_KEY_IDS.has(requestedId) ? 'k1' : requestedId;
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
    }
  };
}

/** The key new credentials for `provider` are sealed with, or null when none is configured. */
export function writeKey(ring: KeyRing, provider: AccountConnectionProvider): RingKey | null {
  return ring.current ?? ring.fallback[provider] ?? null;
}

export function keyById(ring: KeyRing, id: string): RingKey | null {
  if (ring.current?.id === id) return ring.current;
  for (const entry of Object.values(ring.fallback)) if (entry?.id === id) return entry;
  return null;
}

/**
 * Whether a row whose key id is absent from the ring should be treated as a
 * missing configuration (answer `unavailable`, keep the envelope) rather than a
 * rotated key (erase and require reauthorization). Fallback ids and legacy
 * formats always count as missing configuration, and so does a deployment with
 * no current key at all: restoring the variable restores access.
 */
export function missingKeyIsConfiguration(
  ring: KeyRing,
  keyId: string,
  format: AccountConnectionCredentialFormat
): boolean {
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
