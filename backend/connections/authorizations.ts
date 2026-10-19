import type { DatabaseClient } from '@overlord/database';
import type { Selectable } from 'kysely';

import { ChatError } from '../../packages/core/service/chat/store.ts';
import type { AccountConnectionAuthorizations } from '../../packages/core/types/db.ts';

import { hashSecret, sealSecret } from './crypto.ts';
import type { ConnectionRow } from './service.ts';

export const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const MAX_OPEN_AUTHORIZATIONS = 5;
export const AUTHORIZATION_STATE_PATTERN = /^[A-Za-z0-9_-]{40,80}$/;
export const MAX_AUTHORIZATION_CODE_LENGTH = 2048;

/** Retains both historical bindings byte-for-byte, including profile scope's `-`. */
export function verifierAad(
  row: Pick<ConnectionRow, 'owner_profile_id' | 'organization_id' | 'id'>,
  authorizationId: string
) {
  return `overlord:account-connection-authorization:v1:${row.owner_profile_id}:${row.organization_id ?? '-'}:${row.id}:${authorizationId}`;
}

/** Called inside the caller's scoped find-or-create transaction. */
export async function beginAuthorization(
  tx: DatabaseClient,
  options: {
    row: ConnectionRow;
    authorizationId: string;
    state: string;
    verifier: string;
    key: Buffer;
    returnTo: 'mobile' | 'web';
    returnUrl?: string | null;
    expiresAt: string;
    now: string;
  }
) {
  const { row, authorizationId, state, verifier, key, returnTo, expiresAt, now } = options;
  await tx.run(
    'DELETE FROM account_connection_authorizations WHERE connection_id = ? AND (consumed_at IS NOT NULL OR expires_at <= ?)',
    [row.id, now]
  );
  const open = await tx.get<{ n: number | string }>(
    'SELECT COUNT(*) AS n FROM account_connection_authorizations WHERE connection_id = ?',
    [row.id]
  );
  if (Number(open?.n ?? 0) >= MAX_OPEN_AUTHORIZATIONS) throw new ChatError('limit_exceeded');
  await tx.run(
    'INSERT INTO account_connection_authorizations (id, connection_id, state_hash, pkce_verifier_ciphertext, return_to, return_url, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      authorizationId,
      row.id,
      hashSecret(state),
      sealSecret({ plaintext: verifier, key, aad: verifierAad(row, authorizationId) }),
      returnTo,
      options.returnUrl ?? null,
      expiresAt,
      now
    ]
  );
}

/** The optional provider filter retains the profile callback's provider/scope binding. */
export async function consumeAuthorization(
  tx: DatabaseClient,
  options: { state: string; providerFilter?: string; now: string }
) {
  const { state, providerFilter, now } = options;
  const auth = await tx.get<Selectable<AccountConnectionAuthorizations>>(
    providerFilter === undefined
      ? 'SELECT * FROM account_connection_authorizations WHERE state_hash = ?'
      : 'SELECT a.* FROM account_connection_authorizations a JOIN account_connections c ON c.id = a.connection_id WHERE a.state_hash = ? AND c.provider = ? AND c.organization_id IS NULL',
    [hashSecret(state), ...(providerFilter === undefined ? [] : [providerFilter])]
  );
  if (!auth) return null;
  const result = await tx.run(
    'UPDATE account_connection_authorizations SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?',
    [now, auth.id, now]
  );
  const row = await tx.get<ConnectionRow>(
    "SELECT * FROM account_connections WHERE id = ? AND state <> 'disconnected'",
    [auth.connection_id]
  );
  return { auth, row, fresh: result.changes === 1 };
}
