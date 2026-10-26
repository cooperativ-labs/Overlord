import type { StartAccountConnectionResponse } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  AUTHORIZATION_STATE_PATTERN,
  AUTHORIZATION_TTL_MS,
  beginAuthorization,
  consumeAuthorization,
  MAX_AUTHORIZATION_CODE_LENGTH,
  verifierAad
} from './authorizations.ts';
import { recordError } from './credential-rows.ts';
import { openSecret } from './crypto.ts';
import { pkcePair } from './oauth.ts';
import type { ConnectionRow } from './service.ts';

/**
 * The OAuth sign-in sequence both connection scopes share: `AccountConnections`
 * (organization scope) and `ProfileConnections` (profile scope). The scope supplies
 * its row lookup, provider calls, and grant persistence; single-use state, PKCE,
 * consumption, and the callback's failure ladder live here.
 */
export type ConnectionReturnTo = 'mobile' | 'web';

/** Where a callback sends the browser. The organization scope reads only status and returnTo. */
export interface ConnectionCallbackOutcome {
  status: 'connected' | 'denied' | 'expired' | 'failed';
  returnTo: ConnectionReturnTo | null;
  /** An absolute legacy alias target, or a relative web `returnPath`. */
  returnUrl: string | null;
  connectionId: string | null;
  errorCode: string | null;
}

/**
 * Begin a sign-in: hashed single-use state bound to the caller's connection (a live
 * one is reused for a reconnect; otherwise a `pending` row is created), and a PKCE
 * verifier sealed under `key`.
 */
export async function beginConnectionOAuth(
  db: DatabaseClient,
  options: {
    timestamp: (offsetMs?: number) => string;
    key: Buffer;
    returnTo: ConnectionReturnTo;
    returnUrl?: string | null;
    authorizeUrl: (state: string, codeChallenge: string) => string | Promise<string>;
    findLiveRow: (tx: DatabaseClient) => Promise<ConnectionRow | undefined>;
    insertPendingRow: (tx: DatabaseClient, id: string, now: string) => Promise<unknown>;
  }
): Promise<StartAccountConnectionResponse> {
  const state = randomBytes(32).toString('base64url');
  const { verifier, challenge } = pkcePair();
  const authorizeUrl = await options.authorizeUrl(state, challenge);
  const authorizationId = randomUUID();
  const expiresAt = options.timestamp(AUTHORIZATION_TTL_MS);
  const connectionId = await db.transaction(async tx => {
    const now = options.timestamp();
    let row = await options.findLiveRow(tx);
    if (!row) {
      const id = randomUUID();
      await options.insertPendingRow(tx, id, now);
      row = (await tx.get<ConnectionRow>('SELECT * FROM account_connections WHERE id = ?', [id]))!;
    }
    await beginAuthorization(tx, {
      row,
      authorizationId,
      state,
      verifier,
      key: options.key,
      returnTo: options.returnTo,
      returnUrl: options.returnUrl,
      expiresAt,
      now
    });
    return row.id!;
  });
  return { connectionId, authorizeUrl, expiresAt };
}

/** What `persist` did with a fresh grant. */
export type GrantPersistResult = 'stored' | 'disconnected' | { errorCode: string };

/**
 * The public OAuth callback. Consumes the single-use state, exchanges the code with
 * the opened PKCE verifier, then hands the grant to the scope. Records an error code
 * on the connection for a denial, a failed exchange, or a refused grant. Never throws
 * for user-facing input; a grant whose connection was disconnected while the user
 * signed in is revoked, not stored.
 */
export async function completeConnectionOAuth<G>(
  db: DatabaseClient,
  query: { code?: unknown; state?: unknown; error?: unknown },
  options: {
    timestamp: () => string;
    /** Binds the state to one profile-scoped provider (see `consumeAuthorization`). */
    providerFilter?: string;
    /** False fails a well-formed callback before its state is consumed. */
    ready?: () => boolean;
    /** Scope checks before any provider call; false fails without recording an error. */
    admit?: (row: ConnectionRow) => Promise<boolean>;
    /** The key the verifier was sealed with. Throws when the provider cannot exchange. */
    verifierKey: () => Buffer;
    exchange: (code: string, codeVerifier: string) => Promise<G>;
    exchangeErrorCode: (error: unknown) => string;
    /** Checks and stores the grant on the consumed connection. */
    persist: (row: ConnectionRow, grant: G) => Promise<GrantPersistResult>;
    revoke: (grant: G) => Promise<void>;
  }
): Promise<ConnectionCallbackOutcome> {
  const outcome = (
    status: ConnectionCallbackOutcome['status'],
    rest: Partial<ConnectionCallbackOutcome> = {}
  ): ConnectionCallbackOutcome => ({
    status,
    returnTo: null,
    returnUrl: null,
    connectionId: null,
    errorCode: null,
    ...rest
  });
  const state = typeof query.state === 'string' ? query.state : '';
  if (!AUTHORIZATION_STATE_PATTERN.test(state)) return outcome('expired');
  if (options.ready && !options.ready()) return outcome('failed');
  const now = options.timestamp();
  const consumed = await db.transaction(tx =>
    consumeAuthorization(tx, { state, providerFilter: options.providerFilter, now })
  );
  if (!consumed) return outcome('expired');
  const { auth, row } = consumed;
  const target = {
    returnTo: auth.return_to as ConnectionReturnTo,
    returnUrl: auth.return_url ?? null,
    connectionId: auth.connection_id
  };
  if (!consumed.fresh || !row) return outcome('expired', target);
  const fail = async (status: 'denied' | 'failed', code: string) => {
    await recordError(db, row.id!, code, options.timestamp());
    return outcome(status, { ...target, errorCode: code });
  };
  if (query.error !== undefined) return fail('denied', 'authorization_denied');
  const code =
    typeof query.code === 'string' && query.code.length <= MAX_AUTHORIZATION_CODE_LENGTH
      ? query.code
      : '';
  if (!code) return outcome('failed', target);
  if (options.admit && !(await options.admit(row))) return outcome('failed', target);
  let grant: G;
  try {
    const codeVerifier = openSecret({
      envelope: auth.pkce_verifier_ciphertext,
      key: options.verifierKey(),
      aad: verifierAad(row, auth.id!)
    });
    grant = await options.exchange(code, codeVerifier);
  } catch (error) {
    return fail('failed', options.exchangeErrorCode(error));
  }
  const persisted = await options.persist(row, grant);
  if (persisted === 'disconnected') {
    // Disconnected while the user was signing in: discard the new grant.
    await options.revoke(grant);
    return outcome('failed', target);
  }
  if (persisted !== 'stored') return fail('failed', persisted.errorCode);
  return outcome('connected', target);
}
