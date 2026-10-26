import type { DatabaseClient } from '@overlord/database';

import type { ConnectionRow } from './service.ts';

/** Shorter than the provider's 30 s refresh-reuse grace, longer than the 10 s token timeout. */
export const REFRESH_LEASE_MS = 15_000;
const ACCESS_EXPIRY_SKEW_MS = 60_000;

/** Typed access failure for credential consumers (outbound MCP, source checks). */
export class ConnectionAccessError extends Error {
  constructor(readonly code: 'not_found' | 'reauthorization_required' | 'unavailable') {
    super(code);
  }
}

// These writers remain inside the connections module's existing direct-table
// service boundary; routes and extensions must still call the scoped services.
export function requireReauthorization(
  db: DatabaseClient,
  id: string,
  code: string,
  now: string,
  lockOwner?: string
) {
  return db.run(
    `UPDATE account_connections SET state = 'reauthorization_required', credential_ciphertext = NULL, credential_key_id = NULL, access_expires_at = NULL, refresh_lock_owner = NULL, refresh_lock_until = NULL, last_error_code = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'connected'${lockOwner ? ' AND refresh_lock_owner = ?' : ''}`,
    [code, now, id, ...(lockOwner ? [lockOwner] : [])]
  );
}

export function recordError(db: DatabaseClient, id: string, code: string, now: string) {
  return db.run(
    'UPDATE account_connections SET last_error_code = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
    [code, now, id]
  );
}

/** Caller supplies the transaction so erasure and pending-state deletion stay atomic. */
export async function eraseCredential(
  tx: DatabaseClient,
  id: string,
  now: string,
  options: { onlyIfLive: boolean }
) {
  await tx.run(
    `UPDATE account_connections SET state = 'disconnected', credential_ciphertext = NULL, credential_key_id = NULL, access_expires_at = NULL, refresh_expires_at = NULL, refresh_lock_owner = NULL, refresh_lock_until = NULL, disconnected_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?${options.onlyIfLive ? " AND state <> 'disconnected'" : ''}`,
    [now, now, id]
  );
  await tx.run('DELETE FROM account_connection_authorizations WHERE connection_id = ?', [id]);
}

/** A sealed grant and the scope's own columns (scopes, account, workspaces, format). */
export interface StoredGrant {
  ciphertext: string;
  keyId: string;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  /** Scope-specific columns; values are bound and shared grant fields cannot be overridden. */
  columns?: Partial<
    Pick<
      ConnectionRow,
      | 'credential_kind'
      | 'credential_format'
      | 'external_account_id'
      | 'external_account_label'
      | 'external_account_avatar_url'
      | 'granted_scopes_json'
      | 'last_validated_at'
      | 'authorized_workspaces_json'
      | 'tool_policy_version'
    >
  >;
}

/**
 * Persist a freshly sealed grant. Without `leaseOwner` this is the sign-in callback:
 * the row becomes `connected` unless it was disconnected meanwhile. With it, this is
 * a refresh by the lease holder: only a connected row still at the credential
 * revision that was read changes, and a missing refresh expiry keeps the stored one.
 * `changes === 0` means nothing was stored.
 */
export function storeConnectionGrant(
  db: DatabaseClient,
  row: Pick<ConnectionRow, 'id' | 'credential_revision'>,
  grant: StoredGrant,
  options: { now: string; leaseOwner?: string }
) {
  const { now, leaseOwner } = options;
  const columns = Object.entries(grant.columns ?? {});
  const assignments = columns.map(([name]) => `${name} = ?, `).join('');
  const values = columns.map(([, value]) => value);
  if (leaseOwner === undefined)
    return db.run(
      `UPDATE account_connections SET state = 'connected', credential_ciphertext = ?, credential_key_id = ?, credential_revision = credential_revision + 1, access_expires_at = ?, refresh_expires_at = ?, ${assignments}refresh_lock_owner = NULL, refresh_lock_until = NULL, last_refreshed_at = ?, last_error_code = NULL, connected_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state <> 'disconnected'`,
      [
        grant.ciphertext,
        grant.keyId,
        grant.accessExpiresAt,
        grant.refreshExpiresAt,
        ...values,
        now,
        now,
        now,
        row.id
      ]
    );
  return db.run(
    `UPDATE account_connections SET credential_ciphertext = ?, credential_key_id = ?, credential_revision = credential_revision + 1, access_expires_at = ?, refresh_expires_at = COALESCE(?, refresh_expires_at), ${assignments}last_refreshed_at = ?, last_error_code = NULL, refresh_lock_owner = NULL, refresh_lock_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'connected' AND refresh_lock_owner = ? AND credential_revision = ?`,
    [
      grant.ciphertext,
      grant.keyId,
      grant.accessExpiresAt,
      grant.refreshExpiresAt,
      ...values,
      now,
      now,
      row.id,
      leaseOwner,
      row.credential_revision
    ]
  );
}

export function acquireRefreshLease(
  db: DatabaseClient,
  row: ConnectionRow,
  lockOwner: string,
  until: string,
  now: string
) {
  return db.run(
    `UPDATE account_connections SET refresh_lock_owner = ?, refresh_lock_until = ? WHERE id = ? AND state = 'connected' AND credential_revision = ? AND (refresh_lock_owner IS NULL OR refresh_lock_until <= ?)`,
    [lockOwner, until, row.id, row.credential_revision, now]
  );
}

export function releaseRefreshLease(
  db: DatabaseClient,
  row: ConnectionRow,
  lockOwner: string,
  code: string
) {
  return db.run(
    'UPDATE account_connections SET refresh_lock_owner = NULL, refresh_lock_until = NULL, last_error_code = ? WHERE id = ? AND refresh_lock_owner = ?',
    [code, row.id, lockOwner]
  );
}

/** Scoped reads/decryption stay with the caller. Null asks for a reread after re-sealing. */
export async function withRefreshLease<
  C extends { accessToken: string; refreshToken: string | null }
>(
  db: DatabaseClient,
  lockOwner: string,
  options: {
    now: () => number;
    timestamp: (offsetMs?: number) => string;
    sleep: (ms: number) => Promise<void>;
    staleRevision?: number;
    signal?: AbortSignal;
    read: () => Promise<{ row: ConnectionRow; credential: C } | null>;
    requireReauthorization: (row: ConnectionRow, code: string) => Promise<void>;
  },
  refresh: (row: ConnectionRow, refreshToken: string) => Promise<void>
): Promise<{ accessToken: string; credentialRevision: number; row: ConnectionRow }> {
  const deadline = options.now() + REFRESH_LEASE_MS * 2;
  for (;;) {
    if (options.signal?.aborted) throw new ConnectionAccessError('unavailable');
    const found = await options.read();
    if (!found) continue;
    const { row, credential } = found;
    const stale =
      options.staleRevision !== undefined && row.credential_revision <= options.staleRevision;
    const fresh =
      row.access_expires_at === null ||
      Date.parse(row.access_expires_at) - ACCESS_EXPIRY_SKEW_MS > options.now();
    if (!stale && fresh)
      return {
        accessToken: credential.accessToken,
        credentialRevision: row.credential_revision,
        row
      };
    if (!credential.refreshToken) {
      await options.requireReauthorization(row, 'grant_expired');
      throw new ConnectionAccessError('reauthorization_required');
    }
    const leased = await acquireRefreshLease(
      db,
      row,
      lockOwner,
      options.timestamp(REFRESH_LEASE_MS),
      options.timestamp()
    );
    if (leased.changes === 1) {
      await refresh(row, credential.refreshToken);
      continue; // Only a persisted credential is ever used, even after a lost lease.
    }
    if (options.now() > deadline) throw new ConnectionAccessError('unavailable');
    await options.sleep(100);
  }
}

/** Provider exchange and persistence stay scoped; lease failure handling is shared. */
export async function refreshLeased<T>(
  db: DatabaseClient,
  row: ConnectionRow,
  lockOwner: string,
  options: {
    available?: () => boolean;
    exchange: () => Promise<T>;
    invalidGrant: (error: unknown) => boolean;
    requireReauthorization: (code: string) => Promise<void>;
    persist: (grant: T) => Promise<void>;
  }
): Promise<void> {
  const release = async () => {
    await releaseRefreshLease(db, row, lockOwner, 'refresh_unavailable');
    throw new ConnectionAccessError('unavailable');
  };
  if (options.available && !options.available()) return release();
  let grant: T;
  try {
    grant = await options.exchange();
  } catch (error) {
    if (options.invalidGrant(error)) {
      await options.requireReauthorization('invalid_grant');
      throw new ConnectionAccessError('reauthorization_required');
    }
    return release();
  }
  await options.persist(grant);
}
