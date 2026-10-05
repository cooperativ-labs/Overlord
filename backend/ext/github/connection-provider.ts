import { githubOAuthConfigFromEnv } from '@overlord/auth';
import type { DatabaseClient } from '@overlord/database';

import { GITHUB_USER_ENV_KEY_ID } from '../../connections/keyring.ts';
import {
  type ExternalAccount,
  type LegacyCredential,
  type OAuthGrant,
  ProviderOAuthError,
  registerProfileConnectionProvider
} from '../../connections/profile.ts';
import { resolveAuthBaseUrl } from '../../http/public-backend-url.ts';

/**
 * The GitHub account-connection provider adapter (contract v153). The shared
 * connections module owns OAuth state, the PKCE verifier, token storage and
 * encryption, the refresh lease, and disconnect; this adapter supplies only GitHub's
 * HTTP behaviour (confidential client through the Better Auth OAuth App
 * registration) and the pre-v153 `ext_github_user_connections` store, which stays a
 * read-only migration source for one release.
 */
export const GITHUB_SERVER_URL = 'https://github.com';
/** A subpath of the registered `/api/auth/callback/github` login callback. */
export const GITHUB_REPOSITORY_CALLBACK_PATH = '/api/auth/callback/github/repository';
/** The distinct, explicit repository grant; never the login grant. */
export const GITHUB_REPOSITORY_SCOPES = ['repo', 'read:org'] as const;

const GITHUB_API = 'https://api.github.com';
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

interface GitHubTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
}

interface LegacyUserConnectionRow {
  id: string;
  github_user_id: string;
  github_login: string;
  avatar_url: string | null;
  scopes_json: unknown;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  last_validated_at: string;
  created_at: string;
  updated_at: string;
}

function redirectUri(): string {
  return new URL(GITHUB_REPOSITORY_CALLBACK_PATH, resolveAuthBaseUrl()).toString();
}

function requireClient() {
  const client = githubOAuthConfigFromEnv();
  if (!client) throw new ProviderOAuthError('unavailable');
  return client;
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function parseGitHubScopes(value: unknown): string[] {
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

/**
 * GitHub's token endpoint reports failures in the body, often with HTTP 200. A refused
 * code or refresh token is `invalid_grant`; anything else is `unavailable`.
 */
async function tokenRequest(body: Record<string, string>): Promise<OAuthGrant> {
  let response: Response;
  try {
    response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    throw new ProviderOAuthError('unavailable');
  }
  let result: GitHubTokenResponse;
  try {
    result = (await response.json()) as GitHubTokenResponse;
  } catch {
    throw new ProviderOAuthError('unavailable');
  }
  if (result.error === 'bad_verification_code' || result.error === 'bad_refresh_token')
    throw new ProviderOAuthError('invalid_grant');
  if (!response.ok || typeof result.access_token !== 'string' || !result.access_token)
    throw new ProviderOAuthError('unavailable');
  return {
    accessToken: result.access_token,
    refreshToken:
      typeof result.refresh_token === 'string' && result.refresh_token
        ? result.refresh_token
        : null,
    expiresIn: seconds(result.expires_in),
    refreshExpiresIn: seconds(result.refresh_token_expires_in),
    scopes:
      typeof result.scope === 'string'
        ? result.scope
            .split(/[,\s]+/)
            .map(scope => scope.trim())
            .filter(Boolean)
        : []
  };
}

async function describeAccount(accessToken: string): Promise<ExternalAccount & { id: string }> {
  const response = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!response.ok) throw new Error('GitHub account lookup failed');
  const user = (await response.json()) as {
    id?: unknown;
    login?: unknown;
    avatar_url?: unknown;
  };
  const id = typeof user.id === 'number' || typeof user.id === 'string' ? String(user.id) : '';
  const login = typeof user.login === 'string' ? user.login.trim() : '';
  if (!id || !login) throw new Error('GitHub returned incomplete account metadata');
  return {
    id,
    label: login,
    avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null
  };
}

async function revoke(accessToken: string): Promise<void> {
  const client = githubOAuthConfigFromEnv();
  if (!client) return;
  try {
    await fetch(`${GITHUB_API}/applications/${encodeURIComponent(client.clientId)}/token`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ access_token: accessToken })
    });
  } catch {
    // The module has already erased the credential; revocation is best-effort.
  }
}

export function registerGitHubConnectionProvider(): void {
  registerProfileConnectionProvider({
    provider: 'github',
    label: 'GitHub',
    serverUrl: GITHUB_SERVER_URL,
    credentialKind: 'oauth',
    uniqueExternalAccount: true,
    oauth: {
      callbackPath: GITHUB_REPOSITORY_CALLBACK_PATH,
      requiredScopes: GITHUB_REPOSITORY_SCOPES,
      configured: () => githubOAuthConfigFromEnv() !== null,
      authorizeUrl({ state, codeChallenge }) {
        const url = new URL(GITHUB_AUTHORIZE_URL);
        url.searchParams.set('client_id', requireClient().clientId);
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('scope', GITHUB_REPOSITORY_SCOPES.join(' '));
        url.searchParams.set('state', state);
        url.searchParams.set('allow_signup', 'false');
        url.searchParams.set('code_challenge', codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
        return url.toString();
      },
      exchangeCode({ code, codeVerifier }) {
        const client = requireClient();
        return tokenRequest({
          client_id: client.clientId,
          client_secret: client.clientSecret,
          code,
          redirect_uri: redirectUri(),
          code_verifier: codeVerifier
        });
      },
      refresh(refreshToken) {
        const client = requireClient();
        return tokenRequest({
          client_id: client.clientId,
          client_secret: client.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        });
      },
      revoke,
      describeAccount
    },
    legacy: {
      async find(db: DatabaseClient, profileId: string): Promise<LegacyCredential | null> {
        const row = await db.get<LegacyUserConnectionRow>(
          `SELECT id, github_user_id, github_login, avatar_url, scopes_json,
                  access_token_ciphertext, refresh_token_ciphertext,
                  access_token_expires_at, refresh_token_expires_at,
                  last_validated_at, created_at, updated_at
             FROM ext_github_user_connections
            WHERE profile_id = ? AND deleted_at IS NULL AND access_token_ciphertext <> 'revoked:v1'`,
          [profileId]
        );
        if (!row) return null;
        return {
          id: row.id,
          ciphertext: JSON.stringify({
            access: row.access_token_ciphertext,
            refresh: row.refresh_token_ciphertext
          }),
          format: 'github-user-oauth-v1',
          keyId: GITHUB_USER_ENV_KEY_ID,
          account: { id: row.github_user_id, label: row.github_login, avatarUrl: row.avatar_url },
          scopes: parseGitHubScopes(row.scopes_json),
          accessExpiresAt: row.access_token_expires_at,
          refreshExpiresAt: row.refresh_token_expires_at,
          lastValidatedAt: row.last_validated_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      },
      async isLive(db: DatabaseClient, legacyId: string): Promise<boolean> {
        return Boolean(
          await db.get(
            'SELECT 1 AS present FROM ext_github_user_connections WHERE id = ? AND deleted_at IS NULL',
            [legacyId]
          )
        );
      },
      async tombstone(db: DatabaseClient, profileId: string, at: string): Promise<void> {
        await db.run(
          `UPDATE ext_github_user_connections
              SET deleted_at = ?, updated_at = ?, access_token_ciphertext = 'revoked:v1',
                  refresh_token_ciphertext = NULL, access_token_expires_at = NULL,
                  refresh_token_expires_at = NULL, revision = revision + 1
            WHERE profile_id = ? AND deleted_at IS NULL`,
          [at, at, profileId]
        );
      }
    }
  });
}
