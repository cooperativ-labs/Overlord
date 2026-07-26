import { githubOAuthConfigFromEnv } from '@overlord/auth';
import type {
  BeginGitHubUserAuthorizationBody,
  CreatedGitHubRepositoryDto,
  GitHubRepositoryOwnerDto,
  GitHubUserAuthorizationDto,
  GitHubUserConnectionDto
} from '@overlord/contract/ext/github';
import type { DatabaseClient } from '@overlord/database';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { newId, nowIso, requireDatabaseClient, resolveActiveProfileId } from '../../db.ts';
import { ApiError } from '../../errors.ts';
import { resolveAuthBaseUrl } from '../../http/public-backend-url.ts';

const GITHUB_API = 'https://api.github.com';
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_OAUTH_SCOPES = ['repo', 'read:org'] as const;
const USER_OAUTH_CALLBACK_PATH = '/api/auth/callback/github/repository';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000;

type UserOAuthConfig = {
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
};

type UserConnectionRow = {
  id: string;
  profile_id: string;
  github_user_id: string;
  github_login: string;
  avatar_url: string | null;
  scopes_json: unknown;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  revision: number;
};

type OAuthStateRow = {
  id: string;
  profile_id: string;
  return_url: string | null;
  revision: number;
};

type GitHubTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
};

type GitHubUser = {
  id: number;
  login: string;
  avatar_url?: string | null;
};

type GitHubOrganizationMembership = {
  state?: string;
  role?: string;
  organization?: {
    login?: string;
    avatar_url?: string | null;
  };
};

function encryptionKeyFromEnv(): Buffer | null {
  const encoded = process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encoded) return null;
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) return null;
  return key;
}

export function githubUserOAuthConfigured(): boolean {
  return userOAuthConfig() !== null;
}

function userOAuthConfig(): UserOAuthConfig | null {
  const oauth = githubOAuthConfigFromEnv();
  const encryptionKey = encryptionKeyFromEnv();
  if (!oauth || !encryptionKey) return null;
  return { ...oauth, encryptionKey };
}

function requireUserOAuthConfig(): UserOAuthConfig {
  const config = userOAuthConfig();
  if (!config) {
    throw new ApiError(
      503,
      'GitHub repository authorization is not configured on this Overlord server.'
    );
  }
  return config;
}

function tokenAad(profileId: string, kind: 'access' | 'refresh'): Buffer {
  return Buffer.from(`overlord:github-user-oauth:v1:${profileId}:${kind}`, 'utf8');
}

function encryptToken(
  token: string,
  profileId: string,
  kind: 'access' | 'refresh',
  key: Buffer
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(tokenAad(profileId, kind));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${nonce.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptToken(
  envelope: string,
  profileId: string,
  kind: 'access' | 'refresh',
  key: Buffer
): string {
  const [version, nonceText, tagText, ciphertextText, ...extra] = envelope.split('.');
  if (version !== 'v1' || !nonceText || !tagText || !ciphertextText || extra.length > 0) {
    throw new ApiError(503, 'The stored GitHub connection cannot be decrypted.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceText, 'base64url'));
    decipher.setAAD(tokenAad(profileId, kind));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new ApiError(503, 'The stored GitHub connection cannot be decrypted.');
  }
}

function parseScopes(value: unknown): string[] {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((scope): scope is string => typeof scope === 'string')
    : [];
}

function scopesFromTokenResponse(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[,\s]+/)
    .map(scope => scope.trim())
    .filter(Boolean);
}

function expiryFromSeconds(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(Date.now() + value * 1000).toISOString()
    : null;
}

async function activeProfileId(client: DatabaseClient = requireDatabaseClient()): Promise<string> {
  const profileId = await resolveActiveProfileId(client);
  if (!profileId) throw new ApiError(401, 'Authentication required.');
  return profileId;
}

async function readConnection(
  client: DatabaseClient,
  profileId: string
): Promise<UserConnectionRow | null> {
  return (
    (await client.get<UserConnectionRow>(
      `SELECT id, profile_id, github_user_id, github_login, avatar_url, scopes_json,
              access_token_ciphertext, refresh_token_ciphertext,
              access_token_expires_at, refresh_token_expires_at, revision
         FROM ext_github_user_connections
        WHERE profile_id = ? AND deleted_at IS NULL`,
      [profileId]
    )) ?? null
  );
}

function connectionDto(row: UserConnectionRow | null): GitHubUserConnectionDto {
  return {
    configured: githubUserOAuthConfigured(),
    connected: row !== null,
    account: row
      ? {
          id: row.github_user_id,
          login: row.github_login,
          avatarUrl: row.avatar_url
        }
      : null,
    scopes: row ? parseScopes(row.scopes_json) : []
  };
}

export async function getGitHubUserConnection(): Promise<GitHubUserConnectionDto> {
  const client = requireDatabaseClient();
  const profileId = await activeProfileId(client);
  return connectionDto(await readConnection(client, profileId));
}

function stateHash(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

function validatedReturnUrl(
  value: unknown,
  allowedBrowserOrigins: readonly string[]
): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ApiError(400, 'GitHub return URL is invalid.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, 'GitHub return URL is invalid.');
  }
  if (
    url.protocol === 'overlord:' &&
    url.hostname === 'github' &&
    url.pathname === '/callback' &&
    !url.username &&
    !url.password
  ) {
    return url.toString();
  }
  if (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    allowedBrowserOrigins.includes(url.origin)
  ) {
    return url.toString();
  }
  throw new ApiError(400, 'GitHub return URL is not an allowed Overlord destination.');
}

export async function beginGitHubUserAuthorization(
  body: BeginGitHubUserAuthorizationBody,
  allowedBrowserOrigins: readonly string[]
): Promise<GitHubUserAuthorizationDto> {
  const config = requireUserOAuthConfig();
  const client = requireDatabaseClient();
  const profileId = await activeProfileId(client);
  const state = randomBytes(32).toString('base64url');
  const now = nowIso();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
  const returnUrl = validatedReturnUrl(body.returnTo, allowedBrowserOrigins);

  await client.transaction(async tx => {
    await tx.run(
      `UPDATE ext_github_user_oauth_states
          SET deleted_at = ?, updated_at = ?, revision = revision + 1
        WHERE profile_id = ? AND deleted_at IS NULL
          AND (consumed_at IS NOT NULL OR expires_at <= ?)`,
      [now, now, profileId, now]
    );
    await tx.run(
      `INSERT INTO ext_github_user_oauth_states
        (id, profile_id, state_hash, return_url, expires_at, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [newId(), profileId, stateHash(state), returnUrl, expiresAt, now, now]
    );
  });

  const authorizationUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizationUrl.searchParams.set('client_id', config.clientId);
  authorizationUrl.searchParams.set(
    'redirect_uri',
    new URL(USER_OAUTH_CALLBACK_PATH, resolveAuthBaseUrl()).toString()
  );
  authorizationUrl.searchParams.set('scope', USER_OAUTH_SCOPES.join(' '));
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('allow_signup', 'false');
  return { authorizationUrl: authorizationUrl.toString() };
}

async function consumeOAuthState(state: string): Promise<OAuthStateRow> {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(state)) {
    throw new ApiError(400, 'GitHub authorization state is invalid.');
  }
  const client = requireDatabaseClient();
  return client.transaction(async tx => {
    const now = nowIso();
    const row = await tx.get<OAuthStateRow & { expires_at: string; consumed_at: string | null }>(
      `SELECT id, profile_id, return_url, expires_at, consumed_at, revision
         FROM ext_github_user_oauth_states
        WHERE state_hash = ? AND deleted_at IS NULL`,
      [stateHash(state)]
    );
    if (!row || row.consumed_at || row.expires_at <= now) {
      throw new ApiError(400, 'GitHub authorization state has expired or was already used.');
    }
    const updated = await tx.run(
      `UPDATE ext_github_user_oauth_states
          SET consumed_at = ?, updated_at = ?, revision = ?
        WHERE id = ? AND revision = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
      [now, now, row.revision + 1, row.id, row.revision]
    );
    if (updated.changes !== 1) {
      throw new ApiError(400, 'GitHub authorization state has expired or was already used.');
    }
    return row;
  });
}

async function exchangeOAuthToken(input: { code?: string; refreshToken?: string }): Promise<{
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
}> {
  const config = requireUserOAuthConfig();
  const body =
    input.refreshToken === undefined
      ? {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: input.code,
          redirect_uri: new URL(USER_OAUTH_CALLBACK_PATH, resolveAuthBaseUrl()).toString()
        }
      : {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: input.refreshToken
        };
  let response: Response;
  try {
    response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new ApiError(502, 'Could not reach GitHub to complete authorization.');
  }
  let result: GitHubTokenResponse;
  try {
    result = (await response.json()) as GitHubTokenResponse;
  } catch {
    throw new ApiError(502, 'GitHub returned an invalid authorization response.');
  }
  if (!response.ok || typeof result.access_token !== 'string' || !result.access_token) {
    throw new ApiError(502, 'GitHub did not complete repository authorization.');
  }
  const scopes = scopesFromTokenResponse(result.scope);
  if (!USER_OAUTH_SCOPES.every(required => scopes.includes(required))) {
    throw new ApiError(
      403,
      'GitHub authorization did not grant private-repository and organization access.'
    );
  }
  return {
    accessToken: result.access_token,
    refreshToken: typeof result.refresh_token === 'string' ? result.refresh_token : null,
    scopes,
    accessTokenExpiresAt: expiryFromSeconds(result.expires_in),
    refreshTokenExpiresAt: expiryFromSeconds(result.refresh_token_expires_in)
  };
}

async function githubUserFetchUrl<T>(
  url: string,
  token: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ data: T; nextUrl: string | null }> {
  const target = new URL(url, GITHUB_API);
  if (target.origin !== GITHUB_API)
    throw new ApiError(502, 'GitHub returned an invalid page link.');
  let response: Response;
  try {
    response = await fetch(target, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
  } catch {
    throw new ApiError(502, 'Could not reach GitHub.');
  }
  if (!response.ok) {
    const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502;
    throw new ApiError(
      status,
      `GitHub rejected the connected account request (${response.status}).`
    );
  }
  const nextMatch = response.headers
    .get('link')
    ?.split(',')
    .map(part => part.trim())
    .find(part => part.endsWith('rel="next"'))
    ?.match(/^<([^>]+)>/);
  return {
    data: (await response.json()) as T,
    nextUrl: nextMatch?.[1] ?? null
  };
}

async function githubUserFetch<T>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  return (await githubUserFetchUrl<T>(path, token, init)).data;
}

async function githubUserFetchAll<T>(path: string, token: string): Promise<T[]> {
  const rows: T[] = [];
  let nextUrl: string | null = path;
  const visited = new Set<string>();
  while (nextUrl) {
    const canonical = new URL(nextUrl, GITHUB_API).toString();
    if (visited.has(canonical)) throw new ApiError(502, 'GitHub returned a repeated page link.');
    visited.add(canonical);
    const page: { data: T[]; nextUrl: string | null } = await githubUserFetchUrl<T[]>(
      nextUrl,
      token
    );
    rows.push(...page.data);
    nextUrl = page.nextUrl;
  }
  return rows;
}

async function upsertConnection(input: {
  profileId: string;
  user: GitHubUser;
  token: Awaited<ReturnType<typeof exchangeOAuthToken>>;
}): Promise<void> {
  const config = requireUserOAuthConfig();
  const client = requireDatabaseClient();
  const now = nowIso();
  const githubUserId = String(input.user.id);
  const githubLogin = input.user.login.trim();
  if (!githubUserId || !githubLogin) {
    throw new ApiError(502, 'GitHub returned incomplete account metadata.');
  }
  const accessCiphertext = encryptToken(
    input.token.accessToken,
    input.profileId,
    'access',
    config.encryptionKey
  );
  const refreshCiphertext = input.token.refreshToken
    ? encryptToken(input.token.refreshToken, input.profileId, 'refresh', config.encryptionKey)
    : null;

  await client.transaction(async tx => {
    const claimed = await tx.get<{ profile_id: string }>(
      `SELECT profile_id
         FROM ext_github_user_connections
        WHERE github_user_id = ? AND profile_id <> ? AND deleted_at IS NULL`,
      [githubUserId, input.profileId]
    );
    if (claimed) {
      throw new ApiError(409, 'This GitHub account is already connected to another user.');
    }
    const existing = await readConnection(tx, input.profileId);
    if (existing) {
      const updated = await tx.run(
        `UPDATE ext_github_user_connections
            SET github_user_id = ?, github_login = ?, avatar_url = ?, scopes_json = ?,
                access_token_ciphertext = ?, refresh_token_ciphertext = ?,
                access_token_expires_at = ?, refresh_token_expires_at = ?,
                last_validated_at = ?, updated_at = ?, revision = ?
          WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
        [
          githubUserId,
          githubLogin,
          input.user.avatar_url ?? null,
          JSON.stringify(input.token.scopes),
          accessCiphertext,
          refreshCiphertext,
          input.token.accessTokenExpiresAt,
          input.token.refreshTokenExpiresAt,
          now,
          now,
          existing.revision + 1,
          existing.id,
          existing.revision
        ]
      );
      if (updated.changes !== 1) throw new ApiError(409, 'GitHub connection changed; try again.');
      return;
    }
    await tx.run(
      `INSERT INTO ext_github_user_connections
        (id, profile_id, github_user_id, github_login, avatar_url, scopes_json,
         access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at,
         refresh_token_expires_at, last_validated_at, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        newId(),
        input.profileId,
        githubUserId,
        githubLogin,
        input.user.avatar_url ?? null,
        JSON.stringify(input.token.scopes),
        accessCiphertext,
        refreshCiphertext,
        input.token.accessTokenExpiresAt,
        input.token.refreshTokenExpiresAt,
        now,
        now,
        now
      ]
    );
  });
}

export async function completeGitHubUserAuthorization(input: {
  code: string;
  state: string;
}): Promise<{ connection: GitHubUserConnectionDto; returnUrl: string | null }> {
  const oauthState = await consumeOAuthState(input.state);
  if (!input.code.trim()) throw new ApiError(400, 'GitHub authorization code is missing.');
  const token = await exchangeOAuthToken({ code: input.code });
  const user = await githubUserFetch<GitHubUser>('/user', token.accessToken);
  await upsertConnection({ profileId: oauthState.profile_id, user, token });
  const row = await readConnection(requireDatabaseClient(), oauthState.profile_id);
  return { connection: connectionDto(row), returnUrl: oauthState.return_url };
}

async function refreshAccessToken(
  row: UserConnectionRow,
  config: UserOAuthConfig
): Promise<string> {
  if (!row.refresh_token_ciphertext) {
    throw new ApiError(401, 'Reconnect GitHub to refresh repository access.');
  }
  const refreshToken = decryptToken(
    row.refresh_token_ciphertext,
    row.profile_id,
    'refresh',
    config.encryptionKey
  );
  const token = await exchangeOAuthToken({ refreshToken });
  const now = nowIso();
  const accessCiphertext = encryptToken(
    token.accessToken,
    row.profile_id,
    'access',
    config.encryptionKey
  );
  const refreshCiphertext = token.refreshToken
    ? encryptToken(token.refreshToken, row.profile_id, 'refresh', config.encryptionKey)
    : row.refresh_token_ciphertext;
  const updated = await requireDatabaseClient().run(
    `UPDATE ext_github_user_connections
        SET scopes_json = ?, access_token_ciphertext = ?, refresh_token_ciphertext = ?,
            access_token_expires_at = ?, refresh_token_expires_at = ?,
            updated_at = ?, revision = ?
      WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
    [
      JSON.stringify(token.scopes),
      accessCiphertext,
      refreshCiphertext,
      token.accessTokenExpiresAt,
      token.refreshTokenExpiresAt ?? row.refresh_token_expires_at,
      now,
      row.revision + 1,
      row.id,
      row.revision
    ]
  );
  if (updated.changes !== 1) throw new ApiError(409, 'GitHub connection changed; try again.');
  return token.accessToken;
}

async function connectionAccessToken(row: UserConnectionRow): Promise<string> {
  const config = requireUserOAuthConfig();
  if (
    row.access_token_expires_at &&
    new Date(row.access_token_expires_at).getTime() <= Date.now() + TOKEN_EXPIRY_SKEW_MS
  ) {
    return refreshAccessToken(row, config);
  }
  return decryptToken(row.access_token_ciphertext, row.profile_id, 'access', config.encryptionKey);
}

export async function listGitHubRepositoryOwners(): Promise<GitHubRepositoryOwnerDto[]> {
  const client = requireDatabaseClient();
  const profileId = await activeProfileId(client);
  const connection = await readConnection(client, profileId);
  if (!connection) throw new ApiError(409, 'Connect GitHub before choosing a repository owner.');
  const token = await connectionAccessToken(connection);
  const user = await githubUserFetch<GitHubUser>('/user', token);
  if (String(user.id) !== connection.github_user_id) {
    throw new ApiError(401, 'The connected GitHub identity changed; reconnect GitHub.');
  }
  const memberships = await githubUserFetchAll<GitHubOrganizationMembership>(
    '/user/memberships/orgs?state=active&per_page=100',
    token
  );
  const organizations = await Promise.all(
    memberships
      .filter(membership => membership.state === 'active' && membership.organization?.login)
      .map(async membership => {
        const login = membership.organization!.login!.trim();
        const policy = await githubUserFetch<{
          members_can_create_repositories?: boolean;
          members_can_create_private_repositories?: boolean;
        }>(`/orgs/${encodeURIComponent(login)}`, token);
        const canCreate =
          membership.role === 'admin' ||
          Boolean(
            policy.members_can_create_private_repositories ?? policy.members_can_create_repositories
          );
        return canCreate
          ? {
              login,
              type: 'organization' as const,
              avatarUrl: membership.organization?.avatar_url ?? null,
              canCreateRepositories: true as const
            }
          : null;
      })
  );
  const now = nowIso();
  await client.run(
    `UPDATE ext_github_user_connections
        SET github_login = ?, avatar_url = ?, last_validated_at = ?, updated_at = ?,
            revision = revision + 1
      WHERE id = ? AND deleted_at IS NULL`,
    [user.login, user.avatar_url ?? null, now, now, connection.id]
  );
  return [
    {
      login: user.login,
      type: 'personal',
      avatarUrl: user.avatar_url ?? null,
      canCreateRepositories: true
    },
    ...organizations
      .filter((owner): owner is NonNullable<typeof owner> => owner !== null)
      .sort((left, right) => left.login.localeCompare(right.login))
  ];
}

/**
 * Creates an empty private repository through the separate user OAuth
 * connection. This intentionally does not use (or mutate) a workspace GitHub
 * App installation. The owner is revalidated immediately before the write so
 * a cached picker result cannot grant stale organization access.
 */
export async function createPrivateGitHubRepository({
  ownerLogin,
  name
}: {
  ownerLogin: string;
  name: string;
}): Promise<CreatedGitHubRepositoryDto> {
  const normalizedOwner = ownerLogin.trim();
  const normalizedName = name.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(normalizedName)) {
    throw new ApiError(400, 'GitHub repository name is invalid.');
  }
  const owners = await listGitHubRepositoryOwners();
  const owner = owners.find(
    candidate => candidate.login.toLowerCase() === normalizedOwner.toLowerCase()
  );
  if (!owner)
    throw new ApiError(403, 'The selected GitHub owner cannot create private repositories.');

  const client = requireDatabaseClient();
  const profileId = await activeProfileId(client);
  const connection = await readConnection(client, profileId);
  if (!connection) throw new ApiError(409, 'Connect GitHub before creating a repository.');
  const token = await connectionAccessToken(connection);
  const endpoint =
    owner.type === 'personal' ? '/user/repos' : `/orgs/${encodeURIComponent(owner.login)}/repos`;
  const response = await githubUserFetch<{
    id?: number;
    full_name?: string;
    default_branch?: string;
    private?: boolean;
    clone_url?: string;
    owner?: { login?: string };
  }>(endpoint, token, {
    method: 'POST',
    body: { name: normalizedName, private: true, auto_init: false }
  });
  if (
    !response.id ||
    !response.full_name ||
    !response.clone_url ||
    !response.private ||
    response.owner?.login?.toLowerCase() !== owner.login.toLowerCase()
  ) {
    throw new ApiError(502, 'GitHub returned an invalid private repository response.');
  }
  return {
    id: String(response.id),
    fullName: response.full_name,
    defaultBranch: response.default_branch ?? 'main',
    private: true,
    cloneUrl: response.clone_url
  };
}

async function revokeUpstreamToken(token: string, config: UserOAuthConfig): Promise<void> {
  try {
    await fetch(`${GITHUB_API}/applications/${encodeURIComponent(config.clientId)}/token`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ access_token: token })
    });
  } catch {
    // Local revocation must still remove the stored credential when GitHub is unavailable.
  }
}

export async function disconnectGitHubUser(): Promise<GitHubUserConnectionDto> {
  const client = requireDatabaseClient();
  const profileId = await activeProfileId(client);
  let connection = await readConnection(client, profileId);
  if (!connection) return connectionDto(null);
  const config = userOAuthConfig();
  if (config) {
    try {
      const token = await connectionAccessToken(connection);
      await revokeUpstreamToken(token, config);
      connection = (await readConnection(client, profileId)) ?? connection;
    } catch {
      // A local disconnect must still erase the stored credential when the
      // provider is unavailable or the server-held key has rotated.
    }
  }
  const now = nowIso();
  const updated = await client.run(
    `UPDATE ext_github_user_connections
        SET access_token_ciphertext = 'revoked:v1', refresh_token_ciphertext = NULL,
            access_token_expires_at = NULL, refresh_token_expires_at = NULL,
            deleted_at = ?, updated_at = ?, revision = ?
      WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
    [now, now, connection.revision + 1, connection.id, connection.revision]
  );
  if (updated.changes !== 1) throw new ApiError(409, 'GitHub connection changed; try again.');
  return connectionDto(null);
}
