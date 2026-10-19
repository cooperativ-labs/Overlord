import {
  ACCOUNT_CONNECTION_ASSISTANT_WRITE_SCOPES,
  type AccountConnectionAssistantWriteScope,
  type AccountConnectionCredentialFormat,
  type AccountConnectionCredentialKind,
  type AccountConnectionDto,
  type AccountConnectionListResponse,
  type AccountConnectionProvider,
  type AccountConnectionState,
  type StartAccountConnectionResponse
} from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import type { Selectable } from 'kysely';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  ChatError,
  type ChatOwner,
  ChatStore,
  revision as expectedRevision
} from '../../packages/core/service/chat/store.ts';
import type { AccountConnections as AccountConnectionsTable } from '../../packages/core/types/db.ts';

import {
  AUTHORIZATION_STATE_PATTERN,
  AUTHORIZATION_TTL_MS,
  beginAuthorization,
  consumeAuthorization,
  MAX_AUTHORIZATION_CODE_LENGTH,
  verifierAad
} from './authorizations.ts';
import type { ConnectionsConfig } from './config.ts';
import {
  ConnectionAccessError,
  eraseCredential,
  recordError,
  refreshLeased,
  requireReauthorization,
  withRefreshLease
} from './credential-rows.ts';
import { openSecret, sealSecret, SecretEnvelopeError } from './crypto.ts';
import {
  connectionCredentialAad,
  knowledgebaseKeyById,
  missingKeyIsConfiguration,
  type RingKey
} from './keyring.ts';
import { type KnowledgebaseOAuth, OAuthError, pkcePair, type TokenSet } from './oauth.ts';
import { KNOWLEDGEBASE_TOOL_POLICY_VERSION } from './policy.ts';

/**
 * The account-connections module (contract v152): the only writer of
 * `account_connections` and the only reader of credentials. This class serves the
 * organization-scoped providers (Knowledgebase); `ProfileConnections`
 * (`profile.ts`, v153) serves profile-scoped ones over the same table. Every
 * public method is scoped to the caller's profile and organization and answers
 * `not_found` for anything else. Credentials, PKCE verifiers, codes, and OAuth state never
 * leave this module except sealed or hashed.
 */
export type ConnectionRow = Selectable<AccountConnectionsTable>;

interface Credentials {
  accessToken: string;
  refreshToken: string | null;
}

export { ConnectionAccessError, REFRESH_LEASE_MS } from './credential-rows.ts';
export type CallbackStatus = 'connected' | 'denied' | 'expired' | 'failed';
export interface CallbackOutcome {
  status: CallbackStatus;
  returnTo: 'mobile' | 'web' | null;
}

export interface AccountConnectionsOptions {
  config: ConnectionsConfig;
  oauth: KnowledgebaseOAuth | null;
  /** Reads the provider workspaces a fresh grant can see (outbound MCP `list_workspaces`). */
  listWorkspaces?: (accessToken: string) => Promise<string[] | null>;
  /** Called after a connection loses access (disconnect or reauthorization required). */
  onAccessLost?: (connectionId: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const credentialAad = connectionCredentialAad;

function stringArray(json: string): string[] {
  let value: unknown = [];
  try {
    value = JSON.parse(json);
  } catch {
    value = [];
  }
  return Array.isArray(value) ? value.filter((w): w is string => typeof w === 'string') : [];
}

/**
 * The Knowledgebase write scope the owner chose (v158). Anything but an exact
 * `all_workspaces` on a Knowledgebase row is `per_request` (fail closed).
 */
export function assistantWriteScope(
  row: Pick<ConnectionRow, 'provider' | 'assistant_write_scope'>
): AccountConnectionAssistantWriteScope {
  return row.provider === 'knowledgebase' && row.assistant_write_scope === 'all_workspaces'
    ? 'all_workspaces'
    : 'per_request';
}

/** Non-secret projection of any connection row; the credential columns are never read here. */
export function connectionDto(row: ConnectionRow): AccountConnectionDto {
  const hasAccount =
    row.external_account_id !== null ||
    row.external_account_label !== null ||
    row.external_account_avatar_url !== null;
  return {
    id: row.id!,
    provider: row.provider as AccountConnectionProvider,
    organizationId: row.organization_id,
    scope: row.organization_id === null ? 'profile' : 'organization',
    credentialKind: row.credential_kind as AccountConnectionCredentialKind,
    account: hasAccount
      ? {
          id: row.external_account_id,
          label: row.external_account_label,
          avatarUrl: row.external_account_avatar_url
        }
      : null,
    scopes: stringArray(row.granted_scopes_json),
    lastValidatedAt: row.last_validated_at,
    serverUrl: row.server_url,
    state: row.state as AccountConnectionState,
    authorizedWorkspaces: stringArray(row.authorized_workspaces_json),
    assistantWriteScope: assistantWriteScope(row),
    toolPolicyVersion: row.tool_policy_version,
    lastErrorCode: row.last_error_code,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
    revision: row.revision
  };
}

export class AccountConnections {
  private readonly lockOwner = randomUUID();
  constructor(
    readonly db: DatabaseClient,
    private readonly options: AccountConnectionsOptions
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
  private ready() {
    const { knowledgebase, encryption } = this.options.config;
    if (!knowledgebase || !encryption || !this.options.oauth)
      throw new ChatError('provider_not_ready');
    return { knowledgebase, encryption, oauth: this.options.oauth };
  }
  private async access(owner: ChatOwner) {
    await new ChatStore(this.db).access(owner);
  }

  /** The caller's row, or null. Never returns another owner's or organization's row. */
  async row(owner: ChatOwner, id: string): Promise<ConnectionRow | null> {
    return (
      (await this.db.get<ConnectionRow>(
        'SELECT * FROM account_connections WHERE id = ? AND owner_profile_id = ? AND organization_id = ?',
        [id, owner.profileId, owner.organizationId]
      )) ?? null
    );
  }

  /** Live (not disconnected) connections the caller owns in the organization. */
  async liveRows(owner: ChatOwner, provider?: AccountConnectionProvider): Promise<ConnectionRow[]> {
    return this.db.all<ConnectionRow>(
      `SELECT * FROM account_connections WHERE owner_profile_id = ? AND organization_id = ? AND state <> 'disconnected'${provider ? ' AND provider = ?' : ''} ORDER BY created_at, id`,
      [owner.profileId, owner.organizationId, ...(provider ? [provider] : [])]
    );
  }

  async list(owner: ChatOwner): Promise<AccountConnectionListResponse> {
    await this.access(owner);
    const items: AccountConnectionDto[] = [];
    for (const row of await this.liveRows(owner)) {
      // Readiness without a network call: a grant that can no longer be refreshed is not ready.
      const now = this.timestamp();
      if (
        row.state === 'connected' &&
        row.access_expires_at !== null &&
        row.access_expires_at <= now &&
        row.refresh_expires_at !== null &&
        row.refresh_expires_at <= now
      ) {
        await this.requireReauthorization(row.id!, 'grant_expired');
        const fresh = await this.row(owner, row.id!);
        if (fresh) items.push(connectionDto(fresh));
        continue;
      }
      items.push(connectionDto(row));
    }
    return { items };
  }

  async start(owner: ChatOwner, body: unknown): Promise<StartAccountConnectionResponse> {
    const input = body as { provider?: unknown; returnTo?: unknown } | null;
    if (
      !input ||
      input.provider !== 'knowledgebase' ||
      (input.returnTo !== 'mobile' && input.returnTo !== 'web')
    )
      throw new ChatError('invalid_request');
    const returnTo = input.returnTo;
    const { knowledgebase, encryption, oauth } = this.ready();
    await this.access(owner);
    const state = randomBytes(32).toString('base64url');
    const { verifier, challenge } = pkcePair();
    let authorizeUrl: string;
    try {
      authorizeUrl = await oauth.authorizeUrl(state, challenge);
    } catch {
      throw new ChatError('provider_not_ready');
    }
    const authorizationId = randomUUID();
    const expiresAt = this.timestamp(AUTHORIZATION_TTL_MS);
    const connectionId = await this.db.transaction(async tx => {
      const now = this.timestamp();
      let row = await tx.get<ConnectionRow>(
        `SELECT * FROM account_connections WHERE owner_profile_id = ? AND organization_id = ? AND provider = ? AND server_url = ? AND state <> 'disconnected'`,
        [owner.profileId, owner.organizationId, 'knowledgebase', knowledgebase.mcpUrl]
      );
      if (!row) {
        const id = randomUUID();
        await tx.run(
          `INSERT INTO account_connections (id, owner_profile_id, organization_id, provider, server_url, state, tool_policy_version, created_at, updated_at) VALUES (?, ?, ?, 'knowledgebase', ?, 'pending', ?, ?, ?)`,
          [
            id,
            owner.profileId,
            owner.organizationId,
            knowledgebase.mcpUrl,
            KNOWLEDGEBASE_TOOL_POLICY_VERSION,
            now,
            now
          ]
        );
        row = (await tx.get<ConnectionRow>('SELECT * FROM account_connections WHERE id = ?', [
          id
        ]))!;
      }
      await beginAuthorization(tx, {
        row,
        authorizationId,
        state,
        verifier,
        key: encryption.key,
        returnTo,
        expiresAt,
        now
      });
      return row.id!;
    });
    return { connectionId, authorizeUrl, expiresAt };
  }

  /** Public OAuth callback. Consumes the single-use state; never throws for user-facing input. */
  async complete(query: {
    code?: unknown;
    state?: unknown;
    error?: unknown;
  }): Promise<CallbackOutcome> {
    const state = typeof query.state === 'string' ? query.state : '';
    if (!AUTHORIZATION_STATE_PATTERN.test(state)) return { status: 'expired', returnTo: null };
    let ready;
    try {
      ready = this.ready();
    } catch {
      return { status: 'failed', returnTo: null };
    }
    const now = this.timestamp();
    const consumed = await this.db.transaction(tx => consumeAuthorization(tx, { state, now }));
    if (!consumed) return { status: 'expired', returnTo: null };
    const returnTo = consumed.auth.return_to as 'mobile' | 'web';
    const { row, auth } = consumed;
    if (!consumed.fresh || !row) return { status: 'expired', returnTo };
    if (query.error !== undefined) {
      await this.recordError(row.id!, 'authorization_denied');
      return { status: 'denied', returnTo };
    }
    const code =
      typeof query.code === 'string' && query.code.length <= MAX_AUTHORIZATION_CODE_LENGTH
        ? query.code
        : '';
    if (!code) return { status: 'failed', returnTo };
    try {
      await this.access({ profileId: row.owner_profile_id, organizationId: row.organization_id! });
    } catch {
      return { status: 'failed', returnTo };
    }
    let tokens: TokenSet;
    try {
      const verifier = openSecret({
        envelope: auth.pkce_verifier_ciphertext,
        key: ready.encryption.key,
        aad: verifierAad(row, auth.id!)
      });
      tokens = await ready.oauth.exchangeCode(code, verifier);
    } catch (error) {
      await this.recordError(
        row.id!,
        error instanceof OAuthError ? `token_${error.code}` : 'token_exchange_failed'
      );
      return { status: 'failed', returnTo };
    }
    let workspaces: string[] | null = null;
    try {
      workspaces = (await this.options.listWorkspaces?.(tokens.accessToken)) ?? null;
    } catch {
      workspaces = null;
    }
    const stored = await this.db.transaction(async tx => {
      const at = this.timestamp();
      const result = await tx.run(
        `UPDATE account_connections SET state = 'connected', credential_ciphertext = ?, credential_key_id = ?, credential_revision = credential_revision + 1, access_expires_at = ?, refresh_expires_at = ?, authorized_workspaces_json = ?, tool_policy_version = ?, refresh_lock_owner = NULL, refresh_lock_until = NULL, last_refreshed_at = ?, last_error_code = NULL, connected_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state <> 'disconnected'`,
        [
          this.seal(row, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
          ready.encryption.keyId,
          tokens.expiresIn ? this.timestamp(tokens.expiresIn * 1000) : null,
          tokens.refreshExpiresIn ? this.timestamp(tokens.refreshExpiresIn * 1000) : null,
          JSON.stringify(workspaces ?? []),
          KNOWLEDGEBASE_TOOL_POLICY_VERSION,
          at,
          at,
          at,
          row.id
        ]
      );
      return result.changes === 1;
    });
    if (!stored) {
      // Disconnected while the user was signing in: discard the new grant.
      await this.revokeUpstream({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      });
      return { status: 'failed', returnTo };
    }
    return { status: 'connected', returnTo };
  }

  /**
   * `PATCH /api/connections/:id` (v158): the owner's Knowledgebase settings. Only a
   * live Knowledgebase row can change; the write is revision-checked. The MCP client
   * re-reads the row on every call, so narrowing the scope takes effect at once.
   */
  async update(owner: ChatOwner, id: string, body: unknown): Promise<AccountConnectionDto> {
    await this.access(owner);
    const input = body as Record<string, unknown> | null;
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new ChatError('invalid_request');
    const { expectedRevision: expected, assistantWriteScope: scope, ...rest } = input;
    if (
      Object.keys(rest).length ||
      !(ACCOUNT_CONNECTION_ASSISTANT_WRITE_SCOPES as readonly unknown[]).includes(scope)
    )
      throw new ChatError('invalid_request');
    const revision = expectedRevision(expected);
    const row = await this.row(owner, id);
    if (!row || row.state === 'disconnected') throw new ChatError('not_found');
    if (row.provider !== 'knowledgebase') throw new ChatError('invalid_request');
    if (row.revision !== revision) throw new ChatError('stale_revision');
    if (row.assistant_write_scope !== scope) {
      const result = await this.db.run(
        'UPDATE account_connections SET assistant_write_scope = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?',
        [scope as string, this.timestamp(), id, revision]
      );
      if (!result.changes) throw new ChatError('stale_revision');
    }
    return connectionDto((await this.row(owner, id))!);
  }

  async disconnect(owner: ChatOwner, id: string): Promise<AccountConnectionDto> {
    await this.access(owner);
    const row = await this.row(owner, id);
    if (!row || row.state === 'disconnected') throw new ChatError('not_found');
    let credentials: Credentials | null = null;
    try {
      const key = row.credential_key_id
        ? knowledgebaseKeyById(this.options.config.keyRing, row.credential_key_id)
        : null;
      credentials = key ? this.open(row, key) : null;
    } catch {
      credentials = null;
    }
    // Erase first, so a failed upstream revocation never leaves a stored secret.
    await this.db.transaction(async tx => {
      const now = this.timestamp();
      await eraseCredential(tx, id, now, { onlyIfLive: false });
    });
    if (credentials) await this.revokeUpstream(credentials);
    await this.options.onAccessLost?.(id);
    return connectionDto((await this.row(owner, id))!);
  }

  /**
   * A current access token for the caller's connection. Refresh is serialized
   * per connection by a database lease; the rotated credential is persisted
   * before it is returned. Pass `staleRevision` after the provider rejected a
   * token so concurrent callers coalesce on one refresh.
   */
  async accessToken(
    owner: ChatOwner,
    id: string,
    options: { staleRevision?: number; signal?: AbortSignal } = {}
  ): Promise<{ accessToken: string; credentialRevision: number; row: ConnectionRow }> {
    let ready;
    try {
      ready = this.ready();
    } catch {
      throw new ConnectionAccessError('unavailable');
    }
    return withRefreshLease(
      this.db,
      this.lockOwner,
      {
        now: () => this.now(),
        timestamp: offset => this.timestamp(offset),
        sleep: ms => this.sleep(ms),
        staleRevision: options.staleRevision,
        signal: options.signal,
        read: async () => {
          const row = await this.row(owner, id);
          if (!row || row.state === 'disconnected') throw new ConnectionAccessError('not_found');
          if (row.state !== 'connected')
            throw new ConnectionAccessError('reauthorization_required');
          const key = row.credential_key_id
            ? knowledgebaseKeyById(this.options.config.keyRing, row.credential_key_id)
            : null;
          // A key that is merely not configured (yet, or any more) keeps the envelope:
          // restoring the variable restores access. A rotated key cannot be recovered.
          if (
            !key &&
            row.credential_key_id &&
            missingKeyIsConfiguration(
              this.options.config.keyRing,
              row.credential_key_id,
              row.credential_format as AccountConnectionCredentialFormat,
              'organization'
            )
          )
            throw new ConnectionAccessError('unavailable');
          let credentials: Credentials;
          try {
            if (!key) throw new SecretEnvelopeError();
            credentials = this.open(row, key);
          } catch {
            await this.requireReauthorization(id, 'credential_unreadable');
            throw new ConnectionAccessError('reauthorization_required');
          }
          if (key.id !== ready.encryption.keyId) {
            // Sealed under the platform key before an explicit key was added (or the
            // reverse): re-seal under the write key, then reread the persisted row.
            await this.reseal(row, credentials, ready.encryption);
            return null;
          }
          return { row, credential: credentials };
        },
        requireReauthorization: (row, code) => this.requireReauthorization(row.id!, code)
      },
      (row, token) => this.refreshLeased(row, token, ready)
    );
  }

  private async refreshLeased(
    row: ConnectionRow,
    refreshToken: string,
    ready: ReturnType<AccountConnections['ready']>
  ): Promise<void> {
    await refreshLeased(this.db, row, this.lockOwner, {
      exchange: () => ready.oauth.refresh(refreshToken),
      invalidGrant: error => error instanceof OAuthError && error.code === 'invalid_grant',
      requireReauthorization: code => this.requireReauthorization(row.id!, code, this.lockOwner),
      persist: async tokens => {
        const now = this.timestamp();
        // Persist the rotated credential before anyone uses it. A lost lease discards it unused;
        // the provider's reuse grace lets the next holder refresh again from the stored token.
        await this.db.run(
          `UPDATE account_connections SET credential_ciphertext = ?, credential_key_id = ?, credential_revision = credential_revision + 1, access_expires_at = ?, refresh_expires_at = COALESCE(?, refresh_expires_at), last_refreshed_at = ?, last_error_code = NULL, refresh_lock_owner = NULL, refresh_lock_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'connected' AND refresh_lock_owner = ? AND credential_revision = ?`,
          [
            this.seal(row, {
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken ?? refreshToken
            }),
            ready.encryption.keyId,
            tokens.expiresIn ? this.timestamp(tokens.expiresIn * 1000) : null,
            tokens.refreshExpiresIn ? this.timestamp(tokens.refreshExpiresIn * 1000) : null,
            now,
            now,
            row.id,
            this.lockOwner,
            row.credential_revision
          ]
        );
      }
    });
  }

  /** Marks the connection unusable until the owner signs in again and erases its credential. */
  async requireReauthorization(id: string, code: string, lockOwner?: string): Promise<void> {
    const result = await requireReauthorization(this.db, id, code, this.timestamp(), lockOwner);
    if (result.changes === 1) await this.options.onAccessLost?.(id);
  }

  async setAuthorizedWorkspaces(id: string, workspaces: string[]): Promise<void> {
    await this.db.run(
      `UPDATE account_connections SET authorized_workspaces_json = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'connected' AND authorized_workspaces_json <> ?`,
      [JSON.stringify(workspaces), this.timestamp(), id, JSON.stringify(workspaces)]
    );
  }

  private async recordError(id: string, code: string) {
    await recordError(this.db, id, code, this.timestamp());
  }

  private seal(row: ConnectionRow, credentials: Credentials): string {
    const { encryption } = this.ready();
    return sealSecret({
      plaintext: JSON.stringify(credentials),
      key: encryption.key,
      aad: credentialAad(row)
    });
  }

  /** Re-seal the same credential under the write key; the token itself is unchanged. */
  private async reseal(
    row: ConnectionRow,
    credentials: Credentials,
    key: { key: Buffer; keyId: string }
  ) {
    await this.db.run(
      `UPDATE account_connections SET credential_ciphertext = ?, credential_key_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'connected' AND credential_key_id = ? AND credential_revision = ?`,
      [
        sealSecret({
          plaintext: JSON.stringify(credentials),
          key: key.key,
          aad: credentialAad(row)
        }),
        key.keyId,
        this.timestamp(),
        row.id,
        row.credential_key_id,
        row.credential_revision
      ]
    );
  }

  private open(row: ConnectionRow, key: RingKey): Credentials {
    if (!row.credential_ciphertext) throw new SecretEnvelopeError();
    const value = JSON.parse(
      openSecret({
        envelope: row.credential_ciphertext,
        key: key.key,
        aad: credentialAad(row)
      })
    ) as Partial<Credentials>;
    if (typeof value.accessToken !== 'string') throw new SecretEnvelopeError();
    return {
      accessToken: value.accessToken,
      refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : null
    };
  }

  private async revokeUpstream(credentials: Credentials) {
    const oauth = this.options.oauth;
    if (!oauth) return;
    if (credentials.refreshToken) await oauth.revoke(credentials.refreshToken, 'refresh_token');
    await oauth.revoke(credentials.accessToken, 'access_token');
  }
}
