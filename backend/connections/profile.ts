import type {
  AccountConnectionCredentialKind,
  AccountConnectionDto,
  AccountConnectionProvider,
  AccountConnectionProviderStatusDto,
  StartAccountConnectionResponse
} from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import type { Selectable } from 'kysely';
import { randomBytes, randomUUID } from 'node:crypto';

import { ChatError } from '../../packages/core/service/chat/store.ts';
import type { AccountConnectionAuthorizations } from '../../packages/core/types/db.ts';

import { hashSecret, openSecret, sealSecret, SecretEnvelopeError } from './crypto.ts';
import {
  connectionCredentialAad,
  credentialPlaintext,
  keyById,
  type KeyRing,
  keyRingFromEnv,
  missingKeyIsConfiguration,
  openCredential,
  type OpenedCredential,
  type RingKey,
  writeKey
} from './keyring.ts';
import { pkcePair } from './oauth.ts';
import {
  ConnectionAccessError,
  connectionDto,
  type ConnectionRow,
  REFRESH_LEASE_MS
} from './service.ts';

/**
 * Profile-scoped account connections (contract v153): connections a profile owns
 * across every organization (`organization_id` NULL): the Everhour personal API
 * key and the GitHub repository authorization. Like `AccountConnections`, this is
 * the only writer of these rows and the only reader of their credentials. Extensions
 * supply provider behaviour through a registered adapter and obtain plaintext only
 * from `credential()` or `oauthAccessToken()`; they never see an envelope, a key,
 * OAuth state, or a PKCE verifier.
 */
export type ProfileProvider = Exclude<AccountConnectionProvider, 'knowledgebase'>;

/** An upstream account a credential authenticates as. */
export interface ExternalAccount {
  id: string | null;
  label: string | null;
  avatarUrl?: string | null;
}

/** A credential still held by a provider's pre-v153 store, adopted verbatim. */
export interface LegacyCredential {
  id: string;
  ciphertext: string;
  format: 'everhour-user-key-v1' | 'github-user-oauth-v1';
  keyId: string;
  account: ExternalAccount;
  scopes?: string[];
  accessExpiresAt?: string | null;
  refreshExpiresAt?: string | null;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Tokens an OAuth adapter obtained upstream. */
export interface OAuthGrant {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds until the access token expires, when the provider says. */
  expiresIn: number | null;
  refreshExpiresIn: number | null;
  scopes: string[];
}

/** Thrown by an OAuth adapter. `invalid_grant`: the code or refresh token was refused. */
export class ProviderOAuthError extends Error {
  constructor(readonly code: 'invalid_grant' | 'unavailable') {
    super(code);
  }
}

/** The provider HTTP calls of a profile-scoped OAuth provider (confidential client). */
export interface ProfileOAuthAdapter {
  /** The provider's registered callback path on the backend origin. */
  callbackPath: string;
  /** Scopes a grant must include; a grant without all of them stores nothing. */
  requiredScopes: readonly string[];
  /** Whether the OAuth client is configured on this server. */
  configured(): boolean;
  authorizeUrl(input: { state: string; codeChallenge: string }): string;
  /** Throws `ProviderOAuthError`. */
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<OAuthGrant>;
  /** Throws `ProviderOAuthError`. */
  refresh(refreshToken: string): Promise<OAuthGrant>;
  /** Best-effort upstream revocation. */
  revoke(accessToken: string): Promise<void>;
  /** The account a fresh access token authenticates as. */
  describeAccount(accessToken: string): Promise<ExternalAccount & { id: string }>;
}

/** Provider-specific behaviour; storage, encryption, and state stay in the module. */
export interface ProfileConnectionProvider {
  provider: ProfileProvider;
  /** Display name for the callback status page. */
  label?: string;
  serverUrl: string;
  credentialKind: AccountConnectionCredentialKind;
  /** Validate an API key upstream and describe its account. Throws `ProviderCredentialError`. */
  validateApiKey?: (apiKey: string) => Promise<ExternalAccount>;
  /** OAuth providers only. */
  oauth?: ProfileOAuthAdapter;
  /** An upstream account may be live on at most one profile (enforced by an index for `github`). */
  uniqueExternalAccount?: boolean;
  /** The pre-v153 store, while it remains a migration source (one release). */
  legacy?: {
    find(db: DatabaseClient, profileId: string): Promise<LegacyCredential | null>;
    isLive(db: DatabaseClient, legacyId: string): Promise<boolean>;
    /** Soft-delete and scrub the legacy row so a rollback cannot resurrect it. */
    tombstone(db: DatabaseClient, profileId: string, at: string): Promise<void>;
  };
}

/** Thrown by an adapter's upstream validation. */
export class ProviderCredentialError extends Error {
  constructor(
    readonly code: 'rejected' | 'unavailable',
    /** Upstream status and message, for the legacy alias routes' error text only. */
    readonly upstreamStatus?: number,
    readonly upstreamMessage?: string
  ) {
    super(code);
  }
}

const providers = new Map<ProfileProvider, ProfileConnectionProvider>();

/** Register a provider adapter (the v153 account-connection provider extension point). */
export function registerProfileConnectionProvider(adapter: ProfileConnectionProvider): void {
  providers.set(adapter.provider, adapter);
}

export function profileConnectionProvider(provider: unknown): ProfileConnectionProvider | null {
  return providers.get(provider as ProfileProvider) ?? null;
}

const MAX_API_KEY_LENGTH = 512;
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const MAX_OPEN_AUTHORIZATIONS = 5;
const ACCESS_EXPIRY_SKEW_MS = 60_000;
const MAX_RETURN_PATH_LENGTH = 512;

type AuthorizationRow = Selectable<AccountConnectionAuthorizations>;

/** Where a profile-scoped OAuth callback sends the browser. */
export interface ProfileCallbackOutcome {
  status: 'connected' | 'denied' | 'expired' | 'failed';
  returnTo: 'mobile' | 'web' | null;
  /** An absolute legacy alias target, or a relative web `returnPath`. */
  returnUrl: string | null;
  connectionId: string | null;
  errorCode: string | null;
}

/** A relative web return path: starts with `/`, not `//`, no backslash or control character. */
export function isSafeReturnPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_RETURN_PATH_LENGTH &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    ![...value].some(ch => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)
  );
}

function verifierAad(
  row: { owner_profile_id: string; id: string | null },
  authorizationId: string
) {
  return `overlord:account-connection-authorization:v1:${row.owner_profile_id}:-:${row.id}:${authorizationId}`;
}

/**
 * The profile-scoped connections for `db`, keyed from the server environment. This is
 * the credential surface extensions call (`Extension → Account Connections`); it is
 * stateless, so it matches the runtime's instance.
 */
export function profileConnections(
  db: DatabaseClient,
  env: NodeJS.ProcessEnv = process.env
): ProfileConnections {
  return new ProfileConnections(db, keyRingFromEnv(env));
}

export class ProfileConnections {
  private readonly lockOwner = randomUUID();
  constructor(
    readonly db: DatabaseClient,
    private readonly ring: KeyRing,
    private readonly options: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private timestamp(offsetMs = 0) {
    return new Date(this.now() + offsetMs).toISOString();
  }
  private sleep(ms: number) {
    return this.options.sleep?.(ms) ?? new Promise<void>(resolve => setTimeout(resolve, ms));
  }

  /** Every registered provider, with whether a connection can be stored on this server. */
  providers(): AccountConnectionProviderStatusDto[] {
    return [...providers.values()].map(adapter => {
      const reason =
        adapter.oauth && !adapter.oauth.configured()
          ? 'not_configured'
          : writeKey(this.ring, adapter.provider) === null
            ? 'encryption_not_configured'
            : null;
      return {
        provider: adapter.provider,
        scope: 'profile',
        credentialKind: adapter.credentialKind,
        available: reason === null,
        reason
      };
    });
  }

  /** Whether a connection for `provider` can be made on this server right now. */
  available(provider: ProfileProvider): boolean {
    return this.providers().find(entry => entry.provider === provider)?.available === true;
  }

  /** The caller's live profile-scoped connections, adopting legacy rows first. */
  async list(profileId: string): Promise<AccountConnectionDto[]> {
    const items: AccountConnectionDto[] = [];
    for (const adapter of providers.values()) {
      const row = await this.find(profileId, adapter.provider);
      if (row) items.push(connectionDto(row));
    }
    return items;
  }

  /** The caller's row by id, in any state, or null. Never another profile's row. */
  async row(profileId: string, id: string): Promise<ConnectionRow | null> {
    return (
      (await this.db.get<ConnectionRow>(
        'SELECT * FROM account_connections WHERE id = ? AND owner_profile_id = ? AND organization_id IS NULL',
        [id, profileId]
      )) ?? null
    );
  }

  /**
   * The caller's live connection for a provider, or null. When the profile has no
   * row for the provider in any state, a live legacy row is adopted verbatim first
   * (lazy adoption for one release, for rows an older instance wrote after the
   * migration ran). A disconnected profile is never resurrected.
   */
  async find(profileId: string, provider: ProfileProvider): Promise<ConnectionRow | null> {
    const live = await this.liveRow(profileId, provider);
    if (live) return live;
    const adapter = providers.get(provider);
    if (!adapter?.legacy) return null;
    const legacy = await adapter.legacy.find(this.db, profileId);
    if (!legacy) return null;
    await this.db.transaction(async tx => {
      const any = await tx.get(
        'SELECT 1 AS present FROM account_connections WHERE owner_profile_id = ? AND provider = ?',
        [profileId, provider]
      );
      if (any) return;
      if (
        adapter.uniqueExternalAccount &&
        legacy.account.id !== null &&
        (await tx.get(
          `SELECT 1 AS present FROM account_connections WHERE provider = ? AND external_account_id = ? AND state <> 'disconnected'`,
          [provider, legacy.account.id]
        ))
      )
        return;
      await tx.run(
        `INSERT INTO account_connections (id, owner_profile_id, organization_id, provider, server_url, state, credential_kind, credential_format, credential_ciphertext, credential_key_id, credential_revision, access_expires_at, refresh_expires_at, external_account_id, external_account_label, external_account_avatar_url, granted_scopes_json, last_validated_at, connected_at, created_at, updated_at, revision) VALUES (?, ?, NULL, ?, ?, 'connected', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT (id) DO NOTHING`,
        [
          legacy.id,
          profileId,
          provider,
          adapter.serverUrl,
          adapter.credentialKind,
          legacy.format,
          legacy.ciphertext,
          legacy.keyId,
          legacy.accessExpiresAt ?? null,
          legacy.refreshExpiresAt ?? null,
          legacy.account.id,
          legacy.account.label,
          legacy.account.avatarUrl ?? null,
          JSON.stringify(legacy.scopes ?? []),
          legacy.lastValidatedAt,
          legacy.createdAt,
          legacy.createdAt,
          legacy.updatedAt
        ]
      );
    });
    return this.liveRow(profileId, provider);
  }

  private async liveRow(profileId: string, provider: ProfileProvider) {
    return (
      (await this.db.get<ConnectionRow>(
        `SELECT * FROM account_connections WHERE owner_profile_id = ? AND organization_id IS NULL AND provider = ? AND state <> 'disconnected'`,
        [profileId, provider]
      )) ?? null
    );
  }

  /**
   * Store (or rotate) an API key the caller already validated upstream. Answers
   * `provider_not_ready` when no key can seal it; nothing is stored in plaintext.
   */
  async storeApiKey(
    profileId: string,
    provider: ProfileProvider,
    apiKey: string,
    account: ExternalAccount
  ): Promise<AccountConnectionDto> {
    const adapter = providers.get(provider);
    if (!adapter || adapter.credentialKind !== 'api_key')
      throw new ChatError('provider_not_available');
    const key = writeKey(this.ring, provider);
    if (!key) throw new ChatError('provider_not_ready');
    const existing = await this.find(profileId, provider);
    const now = this.timestamp();
    const credential: OpenedCredential = { kind: 'api_key', apiKey };
    if (existing) {
      await this.db.run(
        `UPDATE account_connections SET state = 'connected', credential_kind = 'api_key', credential_format = 'connection-v1', credential_ciphertext = ?, credential_key_id = ?, credential_revision = credential_revision + 1, external_account_id = ?, external_account_label = ?, external_account_avatar_url = ?, last_validated_at = ?, last_error_code = NULL, connected_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND owner_profile_id = ? AND state <> 'disconnected'`,
        [
          this.seal(existing, credential, key),
          key.id,
          account.id,
          account.label,
          account.avatarUrl ?? null,
          now,
          now,
          now,
          existing.id,
          profileId
        ]
      );
      return connectionDto((await this.row(profileId, existing.id!))!);
    }
    const id = randomUUID();
    const draft = { id, owner_profile_id: profileId, organization_id: null, provider };
    await this.db.run(
      `INSERT INTO account_connections (id, owner_profile_id, organization_id, provider, server_url, state, credential_kind, credential_format, credential_ciphertext, credential_key_id, credential_revision, external_account_id, external_account_label, external_account_avatar_url, last_validated_at, connected_at, created_at, updated_at, revision) VALUES (?, ?, NULL, ?, ?, 'connected', 'api_key', 'connection-v1', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        profileId,
        provider,
        adapter.serverUrl,
        this.seal(draft, credential, key),
        key.id,
        account.id,
        account.label,
        account.avatarUrl ?? null,
        now,
        now,
        now,
        now
      ]
    );
    return connectionDto((await this.row(profileId, id))!);
  }

  /** `POST /api/connections/api-keys`: validate upstream through the adapter, then store. */
  async setApiKey(profileId: string, body: unknown): Promise<AccountConnectionDto> {
    const input = body as { provider?: unknown; apiKey?: unknown } | null;
    const adapter = profileConnectionProvider(input?.provider);
    if (!adapter || adapter.credentialKind !== 'api_key' || !adapter.validateApiKey)
      throw new ChatError('provider_not_available');
    const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
    if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH) throw new ChatError('invalid_request');
    if (!writeKey(this.ring, adapter.provider)) throw new ChatError('provider_not_ready');
    let account: ExternalAccount;
    try {
      account = await adapter.validateApiKey(apiKey);
    } catch (error) {
      if (error instanceof ProviderCredentialError && error.code === 'rejected')
        throw new ChatError('credential_rejected');
      throw new ChatError('provider_unavailable');
    }
    return this.storeApiKey(profileId, adapter.provider, apiKey, account);
  }

  /**
   * The caller's plaintext credential for a provider, or null when there is no
   * connected row. Throws `ConnectionAccessError('unavailable')` when the key it
   * was sealed with is not configured (nothing is erased), and
   * `ConnectionAccessError('reauthorization_required')` when the envelope is
   * unreadable (it is erased). Re-seals legacy and fallback-key envelopes under
   * the current key after a successful read.
   */
  async credential(
    profileId: string,
    provider: ProfileProvider
  ): Promise<{ credential: OpenedCredential; row: ConnectionRow } | null> {
    const row = await this.find(profileId, provider);
    if (!row || row.state !== 'connected' || !row.credential_ciphertext || !row.credential_key_id)
      return null;
    if (row.credential_format !== 'connection-v1') {
      // A verbatim copy is honoured only while its source is: an older instance
      // may have disconnected it in the legacy store after the copy was made.
      const legacy = providers.get(provider)?.legacy;
      if (legacy && !(await legacy.isLive(this.db, row.id!))) {
        await this.erase(row, 'disconnected');
        return null;
      }
    }
    const key = keyById(this.ring, row.credential_key_id);
    if (!key) {
      if (
        missingKeyIsConfiguration(
          this.ring,
          row.credential_key_id,
          row.credential_format as Parameters<typeof missingKeyIsConfiguration>[2]
        )
      )
        throw new ConnectionAccessError('unavailable');
      await this.requireReauthorization(row, 'credential_unreadable');
      throw new ConnectionAccessError('reauthorization_required');
    }
    let credential: OpenedCredential;
    try {
      credential = openCredential(
        { ...row, credential_ciphertext: row.credential_ciphertext },
        key.key
      );
    } catch (error) {
      if (!(error instanceof SecretEnvelopeError)) throw error;
      await this.requireReauthorization(row, 'credential_unreadable');
      throw new ConnectionAccessError('reauthorization_required');
    }
    const current = this.ring.current;
    if (
      current &&
      (row.credential_key_id !== current.id || row.credential_format !== 'connection-v1')
    ) {
      await this.reseal(row, credential, current);
      const resealed = await this.row(profileId, row.id!);
      if (resealed?.state === 'connected') return { credential, row: resealed };
    }
    return { credential, row };
  }

  /**
   * `DELETE /api/connections/:id` for a profile-scoped row: erase first, then revoke
   * an OAuth token upstream (best-effort), then tombstone the legacy row.
   */
  async disconnect(profileId: string, id: string): Promise<AccountConnectionDto> {
    const row = await this.row(profileId, id);
    if (!row || row.state === 'disconnected') throw new ChatError('not_found');
    await this.disconnectRow(profileId, row.provider as ProfileProvider, row);
    return connectionDto((await this.row(profileId, id))!);
  }

  /** Disconnect the caller's connection for a provider, if any (legacy alias routes). */
  async disconnectProvider(profileId: string, provider: ProfileProvider): Promise<void> {
    await this.disconnectRow(profileId, provider, await this.find(profileId, provider));
  }

  private async disconnectRow(
    profileId: string,
    provider: ProfileProvider,
    row: ConnectionRow | null
  ): Promise<void> {
    const adapter = providers.get(provider);
    const credential = row ? this.peek(row) : null;
    // Erase first, so a failed upstream revocation never leaves a stored secret.
    if (row) await this.erase(row, 'disconnected');
    if (credential?.kind === 'oauth' && adapter?.oauth)
      await adapter.oauth.revoke(credential.accessToken).catch(() => undefined);
    await adapter?.legacy?.tombstone(this.db, profileId, this.timestamp());
  }

  // ---- OAuth (profile-scoped, confidential client) --------------------------

  /** `POST /api/connections` for a profile-scoped OAuth provider. */
  async startOAuth(profileId: string, body: unknown): Promise<StartAccountConnectionResponse> {
    const input = body as { provider?: unknown; returnTo?: unknown; returnPath?: unknown } | null;
    const adapter = profileConnectionProvider(input?.provider);
    if (!adapter?.oauth) throw new ChatError('provider_not_available');
    if (input?.returnTo !== 'mobile' && input?.returnTo !== 'web')
      throw new ChatError('invalid_request');
    let returnUrl: string | null = null;
    if (input.returnPath !== undefined && input.returnPath !== null) {
      if (input.returnTo !== 'web' || !isSafeReturnPath(input.returnPath))
        throw new ChatError('invalid_request');
      returnUrl = input.returnPath;
    }
    return this.beginOAuth(profileId, adapter.provider, { returnTo: input.returnTo, returnUrl });
  }

  /**
   * Begin a sign-in: hashed single-use state bound to the caller's connection (a live
   * one is reused for a reconnect; otherwise a `pending` row is created), and a PKCE
   * verifier sealed under the provider's write key. `returnUrl` is either a relative
   * web path or an absolute target a legacy alias already validated.
   */
  async beginOAuth(
    profileId: string,
    provider: ProfileProvider,
    target: { returnTo: 'mobile' | 'web'; returnUrl: string | null }
  ): Promise<StartAccountConnectionResponse> {
    const adapter = providers.get(provider);
    const oauth = adapter?.oauth;
    if (!adapter || !oauth) throw new ChatError('provider_not_available');
    const key = writeKey(this.ring, provider);
    if (!key || !oauth.configured()) throw new ChatError('provider_not_ready');
    const state = randomBytes(32).toString('base64url');
    const { verifier, challenge } = pkcePair();
    const authorizeUrl = oauth.authorizeUrl({ state, codeChallenge: challenge });
    const authorizationId = randomUUID();
    const expiresAt = this.timestamp(AUTHORIZATION_TTL_MS);
    // Adopt a legacy row first, so a reconnect reuses (and replaces) it.
    await this.find(profileId, provider);
    const connectionId = await this.db.transaction(async tx => {
      const now = this.timestamp();
      let row = await tx.get<ConnectionRow>(
        `SELECT * FROM account_connections WHERE owner_profile_id = ? AND organization_id IS NULL AND provider = ? AND state <> 'disconnected'`,
        [profileId, provider]
      );
      if (!row) {
        const id = randomUUID();
        await tx.run(
          `INSERT INTO account_connections (id, owner_profile_id, organization_id, provider, server_url, state, credential_kind, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 'pending', ?, ?, ?)`,
          [id, profileId, provider, adapter.serverUrl, adapter.credentialKind, now, now]
        );
        row = (await tx.get<ConnectionRow>('SELECT * FROM account_connections WHERE id = ?', [
          id
        ]))!;
      }
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
          sealSecret({ plaintext: verifier, key: key.key, aad: verifierAad(row, authorizationId) }),
          target.returnTo,
          target.returnUrl,
          expiresAt,
          now
        ]
      );
      return row.id!;
    });
    return { connectionId, authorizeUrl, expiresAt };
  }

  /**
   * The provider's public callback. Consumes the single-use state (bound to this
   * provider), exchanges the code, checks the required scopes and the account, then
   * seals the grant. Never throws for user-facing input; stores nothing on failure.
   */
  async completeOAuth(
    provider: ProfileProvider,
    query: { code?: unknown; state?: unknown; error?: unknown }
  ): Promise<ProfileCallbackOutcome> {
    const adapter = providers.get(provider);
    const oauth = adapter?.oauth;
    const state = typeof query.state === 'string' ? query.state : '';
    const outcome = (
      status: ProfileCallbackOutcome['status'],
      rest: Partial<ProfileCallbackOutcome> = {}
    ): ProfileCallbackOutcome => ({
      status,
      returnTo: null,
      returnUrl: null,
      connectionId: null,
      errorCode: null,
      ...rest
    });
    if (!adapter || !oauth || !/^[A-Za-z0-9_-]{40,80}$/.test(state)) return outcome('expired');
    const now = this.timestamp();
    const consumed = await this.db.transaction(async tx => {
      const auth = await tx.get<AuthorizationRow>(
        `SELECT a.* FROM account_connection_authorizations a JOIN account_connections c ON c.id = a.connection_id WHERE a.state_hash = ? AND c.provider = ? AND c.organization_id IS NULL`,
        [hashSecret(state), provider]
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
    });
    if (!consumed) return outcome('expired');
    const { auth, row } = consumed;
    const target = {
      returnTo: auth.return_to as 'mobile' | 'web',
      returnUrl: auth.return_url ?? null,
      connectionId: auth.connection_id
    };
    if (!consumed.fresh || !row) return outcome('expired', target);
    const fail = async (status: 'denied' | 'failed', code: string) => {
      await this.recordError(row.id!, code);
      return outcome(status, { ...target, errorCode: code });
    };
    if (query.error !== undefined) return fail('denied', 'authorization_denied');
    const code = typeof query.code === 'string' && query.code.length <= 2048 ? query.code : '';
    if (!code) return outcome('failed', target);
    const key = writeKey(this.ring, provider);
    let grant: OAuthGrant;
    try {
      if (!key || !oauth.configured()) throw new ProviderOAuthError('unavailable');
      const verifier = openSecret({
        envelope: auth.pkce_verifier_ciphertext,
        key: key.key,
        aad: verifierAad(row, auth.id!)
      });
      grant = await oauth.exchangeCode({ code, codeVerifier: verifier });
    } catch (error) {
      return fail(
        'failed',
        error instanceof ProviderOAuthError ? `token_${error.code}` : 'token_exchange_failed'
      );
    }
    if (!oauth.requiredScopes.every(scope => grant.scopes.includes(scope)))
      return fail('failed', 'insufficient_scope');
    let account: ExternalAccount & { id: string };
    try {
      account = await oauth.describeAccount(grant.accessToken);
    } catch {
      return fail('failed', 'account_lookup_failed');
    }
    if (
      adapter.uniqueExternalAccount &&
      (await this.db.get(
        `SELECT 1 AS present FROM account_connections WHERE provider = ? AND external_account_id = ? AND owner_profile_id <> ? AND state <> 'disconnected'`,
        [provider, account.id, row.owner_profile_id]
      ))
    )
      return fail('failed', 'account_in_use');
    const at = this.timestamp();
    let stored: boolean;
    try {
      const result = await this.db.run(
        `UPDATE account_connections SET state = 'connected', credential_kind = 'oauth', credential_format = 'connection-v1', credential_ciphertext = ?, credential_key_id = ?, credential_revision = credential_revision + 1, access_expires_at = ?, refresh_expires_at = ?, external_account_id = ?, external_account_label = ?, external_account_avatar_url = ?, granted_scopes_json = ?, last_validated_at = ?, refresh_lock_owner = NULL, refresh_lock_until = NULL, last_refreshed_at = ?, last_error_code = NULL, connected_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state <> 'disconnected'`,
        [
          this.seal(
            row,
            { kind: 'oauth', accessToken: grant.accessToken, refreshToken: grant.refreshToken },
            key!
          ),
          key!.id,
          grant.expiresIn ? this.timestamp(grant.expiresIn * 1000) : null,
          grant.refreshExpiresIn ? this.timestamp(grant.refreshExpiresIn * 1000) : null,
          account.id,
          account.label,
          account.avatarUrl ?? null,
          JSON.stringify(grant.scopes),
          at,
          at,
          at,
          at,
          row.id
        ]
      );
      stored = result.changes === 1;
    } catch {
      // The unique live-account index: the account went live on another profile meanwhile.
      return fail('failed', 'account_in_use');
    }
    if (!stored) {
      // Disconnected while the user was signing in: discard the new grant.
      await oauth.revoke(grant.accessToken).catch(() => undefined);
      return outcome('failed', target);
    }
    return outcome('connected', target);
  }

  /**
   * A current OAuth access token for the caller's connection. An expiring token is
   * refreshed under a per-connection database lease, so concurrent callers share one
   * upstream refresh, and the rotated credential is persisted before it is returned.
   * Pass `staleRevision` after the provider rejected a token to force that refresh.
   */
  async oauthAccessToken(
    profileId: string,
    provider: ProfileProvider,
    options: { staleRevision?: number } = {}
  ): Promise<{ accessToken: string; credentialRevision: number; row: ConnectionRow }> {
    const oauth = providers.get(provider)?.oauth;
    if (!oauth) throw new ConnectionAccessError('not_found');
    const deadline = this.now() + REFRESH_LEASE_MS * 2;
    for (;;) {
      const found = await this.credential(profileId, provider);
      if (!found || found.credential.kind !== 'oauth') {
        const live = await this.liveRow(profileId, provider);
        throw new ConnectionAccessError(
          live?.state === 'reauthorization_required' ? 'reauthorization_required' : 'not_found'
        );
      }
      const { row } = found;
      const credential = found.credential;
      const stale =
        options.staleRevision !== undefined && row.credential_revision <= options.staleRevision;
      const fresh =
        row.access_expires_at === null ||
        Date.parse(row.access_expires_at) - ACCESS_EXPIRY_SKEW_MS > this.now();
      if (!stale && fresh)
        return {
          accessToken: credential.accessToken,
          credentialRevision: row.credential_revision,
          row
        };
      if (!credential.refreshToken) {
        await this.requireReauthorization(row, 'grant_expired');
        throw new ConnectionAccessError('reauthorization_required');
      }
      const leased = await this.db.run(
        `UPDATE account_connections SET refresh_lock_owner = ?, refresh_lock_until = ? WHERE id = ? AND state = 'connected' AND credential_revision = ? AND (refresh_lock_owner IS NULL OR refresh_lock_until <= ?)`,
        [
          this.lockOwner,
          this.timestamp(REFRESH_LEASE_MS),
          row.id,
          row.credential_revision,
          this.timestamp()
        ]
      );
      if (leased.changes === 1) {
        await this.refreshLeased(row, provider, oauth, credential.refreshToken);
        continue; // Reread: only a persisted credential is ever used.
      }
      if (this.now() > deadline) throw new ConnectionAccessError('unavailable');
      await this.sleep(100);
    }
  }

  private async refreshLeased(
    row: ConnectionRow,
    provider: ProfileProvider,
    oauth: ProfileOAuthAdapter,
    refreshToken: string
  ): Promise<void> {
    const release = async (code: string) => {
      await this.db.run(
        'UPDATE account_connections SET refresh_lock_owner = NULL, refresh_lock_until = NULL, last_error_code = ? WHERE id = ? AND refresh_lock_owner = ?',
        [code, row.id, this.lockOwner]
      );
      throw new ConnectionAccessError('unavailable');
    };
    const key = writeKey(this.ring, provider);
    if (!key || !oauth.configured()) return release('refresh_unavailable');
    let grant: OAuthGrant;
    try {
      grant = await oauth.refresh(refreshToken);
    } catch (error) {
      if (error instanceof ProviderOAuthError && error.code === 'invalid_grant') {
        await this.requireReauthorization(row, 'invalid_grant', this.lockOwner);
        throw new ConnectionAccessError('reauthorization_required');
      }
      return release('refresh_unavailable');
    }
    if (!oauth.requiredScopes.every(scope => grant.scopes.includes(scope))) {
      await this.requireReauthorization(row, 'insufficient_scope', this.lockOwner);
      throw new ConnectionAccessError('reauthorization_required');
    }
    const now = this.timestamp();
    await this.db.run(
      `UPDATE account_connections SET credential_ciphertext = ?, credential_key_id = ?, credential_format = 'connection-v1', credential_revision = credential_revision + 1, access_expires_at = ?, refresh_expires_at = COALESCE(?, refresh_expires_at), granted_scopes_json = ?, last_refreshed_at = ?, last_error_code = NULL, refresh_lock_owner = NULL, refresh_lock_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'connected' AND refresh_lock_owner = ? AND credential_revision = ?`,
      [
        this.seal(
          row,
          {
            kind: 'oauth',
            accessToken: grant.accessToken,
            refreshToken: grant.refreshToken ?? refreshToken
          },
          key
        ),
        key.id,
        grant.expiresIn ? this.timestamp(grant.expiresIn * 1000) : null,
        grant.refreshExpiresIn ? this.timestamp(grant.refreshExpiresIn * 1000) : null,
        JSON.stringify(grant.scopes),
        now,
        now,
        row.id,
        this.lockOwner,
        row.credential_revision
      ]
    );
  }

  /** Record a re-validated upstream account for the caller's connected row. */
  async recordAccount(
    profileId: string,
    provider: ProfileProvider,
    account: ExternalAccount
  ): Promise<void> {
    const now = this.timestamp();
    await this.db.run(
      `UPDATE account_connections SET external_account_label = ?, external_account_avatar_url = ?, last_validated_at = ?, updated_at = ?, revision = revision + 1 WHERE owner_profile_id = ? AND organization_id IS NULL AND provider = ? AND state = 'connected'`,
      [account.label, account.avatarUrl ?? null, now, now, profileId, provider]
    );
  }

  /** Mark the caller's connection unusable until they sign in again (erases the credential). */
  async requireReauthorizationFor(
    profileId: string,
    provider: ProfileProvider,
    code: string
  ): Promise<void> {
    const row = await this.liveRow(profileId, provider);
    if (row) await this.requireReauthorization(row, code);
  }

  /**
   * Re-seal connected profile-scoped rows still under a legacy format or a
   * fallback key. Bounded and idempotent; logs counts only.
   */
  async resealSweep(limit = 500): Promise<{ resealed: number; remaining: number }> {
    const current = this.ring.current;
    if (!current) return { resealed: 0, remaining: await this.legacyKeyedCount() };
    const rows = await this.db.all<ConnectionRow>(
      `SELECT * FROM account_connections WHERE organization_id IS NULL AND state = 'connected' AND (credential_format <> 'connection-v1' OR credential_key_id <> ?) ORDER BY created_at, id LIMIT ?`,
      [current.id, limit]
    );
    let resealed = 0;
    for (const row of rows) {
      try {
        if (await this.credential(row.owner_profile_id, row.provider as ProfileProvider))
          resealed += 1;
      } catch {
        // Unavailable or unreadable rows are handled (or kept) by `credential()`.
      }
    }
    return { resealed, remaining: await this.legacyKeyedCount() };
  }

  private async legacyKeyedCount(): Promise<number> {
    const row = await this.db.get<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM account_connections WHERE organization_id IS NULL AND credential_ciphertext IS NOT NULL AND (credential_format <> 'connection-v1' OR credential_key_id <> ?)`,
      [this.ring.current?.id ?? '']
    );
    return Number(row?.n ?? 0);
  }

  private seal(
    row: {
      id: string | null;
      owner_profile_id: string;
      organization_id: string | null;
      provider: string;
    },
    credential: OpenedCredential,
    key: RingKey
  ): string {
    return sealSecret({
      plaintext: credentialPlaintext(credential),
      key: key.key,
      aad: connectionCredentialAad(row)
    });
  }

  private async reseal(row: ConnectionRow, credential: OpenedCredential, key: RingKey) {
    await this.db.run(
      `UPDATE account_connections SET credential_ciphertext = ?, credential_key_id = ?, credential_format = 'connection-v1', credential_revision = credential_revision + 1, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'connected' AND credential_revision = ?`,
      [this.seal(row, credential, key), key.id, this.timestamp(), row.id, row.credential_revision]
    );
  }

  /** Open a row's credential without side effects (disconnect's upstream revocation). */
  private peek(row: ConnectionRow): OpenedCredential | null {
    if (!row.credential_ciphertext || !row.credential_key_id) return null;
    const key = keyById(this.ring, row.credential_key_id);
    if (!key) return null;
    try {
      return openCredential({ ...row, credential_ciphertext: row.credential_ciphertext }, key.key);
    } catch {
      return null;
    }
  }

  private async erase(row: ConnectionRow, state: 'disconnected') {
    const now = this.timestamp();
    await this.db.transaction(async tx => {
      await tx.run(
        `UPDATE account_connections SET state = ?, credential_ciphertext = NULL, credential_key_id = NULL, access_expires_at = NULL, refresh_expires_at = NULL, refresh_lock_owner = NULL, refresh_lock_until = NULL, disconnected_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state <> 'disconnected'`,
        [state, now, now, row.id]
      );
      await tx.run('DELETE FROM account_connection_authorizations WHERE connection_id = ?', [
        row.id
      ]);
    });
  }

  private async requireReauthorization(row: ConnectionRow, code: string, lockOwner?: string) {
    await this.db.run(
      `UPDATE account_connections SET state = 'reauthorization_required', credential_ciphertext = NULL, credential_key_id = NULL, access_expires_at = NULL, refresh_lock_owner = NULL, refresh_lock_until = NULL, last_error_code = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'connected'${lockOwner ? ' AND refresh_lock_owner = ?' : ''}`,
      [code, this.timestamp(), row.id, ...(lockOwner ? [lockOwner] : [])]
    );
  }

  private async recordError(id: string, code: string) {
    await this.db.run(
      'UPDATE account_connections SET last_error_code = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
      [code, this.timestamp(), id]
    );
  }
}
