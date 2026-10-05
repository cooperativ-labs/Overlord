import type {
  BeginGitHubUserAuthorizationBody,
  CreatedGitHubRepositoryDto,
  GitHubRepositoryOwnerDto,
  GitHubUserAuthorizationDto,
  GitHubUserConnectionDto
} from '@overlord/contract/ext/github';
import type { DatabaseClient } from '@overlord/database';

import { ChatError } from '../../../packages/core/service/chat/store.ts';
import { profileConnections } from '../../connections/profile.ts';
import { ConnectionAccessError, type ConnectionRow } from '../../connections/service.ts';
import { requireDatabaseClient, resolveActiveProfileId } from '../../db.ts';
import { ApiError } from '../../errors.ts';

import { parseGitHubScopes, registerGitHubConnectionProvider } from './connection-provider.ts';

// The personal repository authorization lives in the shared account-connections
// module (contract v153): it owns the OAuth state, PKCE verifier, token storage and
// encryption, the refresh lease, and disconnect, and serves the callback at
// `/api/auth/callback/github/repository`. These functions are the `/ext/github`
// compatibility aliases over it plus the repository-owner and repository-creation
// features, which obtain the token only through `oauthAccessToken()`.
registerGitHubConnectionProvider();

const GITHUB_API = 'https://api.github.com';
const NOT_CONFIGURED = 'GitHub repository authorization is not configured on this Overlord server.';
const RECONNECT = 'Reconnect GitHub to refresh repository access.';

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

function connections(client: DatabaseClient = requireDatabaseClient()) {
  return profileConnections(client);
}

export function githubUserOAuthConfigured(client?: DatabaseClient): boolean {
  return connections(client).available('github');
}

async function activeProfileId(client: DatabaseClient = requireDatabaseClient()): Promise<string> {
  const profileId = await resolveActiveProfileId(client);
  if (!profileId) throw new ApiError(401, 'Authentication required.');
  return profileId;
}

function connectionDto(
  row: ConnectionRow | null,
  client?: DatabaseClient
): GitHubUserConnectionDto {
  const connected = row?.state === 'connected';
  return {
    configured: githubUserOAuthConfigured(client),
    connected,
    account:
      connected && row.external_account_id && row.external_account_label
        ? {
            id: row.external_account_id,
            login: row.external_account_label,
            avatarUrl: row.external_account_avatar_url
          }
        : null,
    scopes: connected ? parseGitHubScopes(row.granted_scopes_json) : []
  };
}

export async function getGitHubUserConnection(): Promise<GitHubUserConnectionDto> {
  const client = requireDatabaseClient();
  const profileId = await activeProfileId(client);
  return connectionDto(await connections(client).find(profileId, 'github'), client);
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

/** `POST /ext/github/user-connection/authorize` (alias): legacy `returnTo` URL semantics. */
export async function beginGitHubUserAuthorization(
  body: BeginGitHubUserAuthorizationBody,
  allowedBrowserOrigins: readonly string[]
): Promise<GitHubUserAuthorizationDto> {
  const client = requireDatabaseClient();
  const store = connections(client);
  if (!store.available('github')) throw new ApiError(503, NOT_CONFIGURED);
  const profileId = await activeProfileId(client);
  const returnUrl = validatedReturnUrl(body.returnTo, allowedBrowserOrigins);
  try {
    const started = await store.beginOAuth(profileId, 'github', {
      returnTo: returnUrl?.startsWith('overlord:') ? 'mobile' : 'web',
      returnUrl
    });
    return { authorizationUrl: started.authorizeUrl };
  } catch (error) {
    if (error instanceof ChatError && error.code === 'provider_not_ready')
      throw new ApiError(503, NOT_CONFIGURED);
    if (error instanceof ChatError && error.code === 'limit_exceeded')
      throw new ApiError(429, 'Too many GitHub sign-ins are open; try again in a few minutes.');
    throw error;
  }
}

/**
 * Complete a sign-in through the module, as the callback does, with the pre-v153
 * error text. The callback route itself is the module's handler; this remains for
 * in-process callers.
 */
export async function completeGitHubUserAuthorization(input: {
  code: string;
  state: string;
}): Promise<{ connection: GitHubUserConnectionDto; returnUrl: string | null }> {
  const client = requireDatabaseClient();
  const outcome = await connections(client).completeOAuth('github', input);
  if (outcome.status === 'expired')
    throw new ApiError(400, 'GitHub authorization state has expired or was already used.');
  if (outcome.status !== 'connected') {
    if (outcome.errorCode === 'insufficient_scope')
      throw new ApiError(
        403,
        'GitHub authorization did not grant private-repository and organization access.'
      );
    if (outcome.errorCode === 'account_in_use')
      throw new ApiError(409, 'This GitHub account is already connected to another user.');
    throw new ApiError(502, 'GitHub did not complete repository authorization.');
  }
  const row = await client.get<ConnectionRow>('SELECT * FROM account_connections WHERE id = ?', [
    outcome.connectionId
  ]);
  return { connection: connectionDto(row ?? null, client), returnUrl: outcome.returnUrl };
}

function accessError(error: unknown, notConnected: string, client: DatabaseClient): unknown {
  if (!(error instanceof ConnectionAccessError)) return error;
  if (error.code === 'not_found') return new ApiError(409, notConnected);
  if (error.code === 'reauthorization_required') return new ApiError(401, RECONNECT);
  return githubUserOAuthConfigured(client)
    ? new ApiError(502, 'Could not reach GitHub.')
    : new ApiError(503, NOT_CONFIGURED);
}

async function connectedToken(
  client: DatabaseClient,
  profileId: string,
  notConnected: string,
  staleRevision?: number
) {
  try {
    return await connections(client).oauthAccessToken(profileId, 'github', { staleRevision });
  } catch (error) {
    throw accessError(error, notConnected, client);
  }
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

export async function listGitHubRepositoryOwners(): Promise<GitHubRepositoryOwnerDto[]> {
  const client = requireDatabaseClient();
  const profileId = await activeProfileId(client);
  const store = connections(client);
  const notConnected = 'Connect GitHub before choosing a repository owner.';
  let access = await connectedToken(client, profileId, notConnected);
  let user: GitHubUser;
  try {
    user = await githubUserFetch<GitHubUser>('/user', access.accessToken);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    // Rejected upstream: refresh once (shared with concurrent callers), then give up.
    access = await connectedToken(client, profileId, notConnected, access.credentialRevision);
    try {
      user = await githubUserFetch<GitHubUser>('/user', access.accessToken);
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401) {
        await store.requireReauthorizationFor(profileId, 'github', 'invalid_grant');
        throw new ApiError(401, RECONNECT);
      }
      throw retryError;
    }
  }
  const token = access.accessToken;
  if (String(user.id) !== access.row.external_account_id) {
    await store.requireReauthorizationFor(profileId, 'github', 'identity_changed');
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
  await store.recordAccount(profileId, 'github', {
    id: String(user.id),
    label: user.login,
    avatarUrl: user.avatar_url ?? null
  });
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
  const { accessToken: token } = await connectedToken(
    client,
    profileId,
    'Connect GitHub before creating a repository.'
  );
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

/** `DELETE /ext/github/user-connection` (alias): erase, revoke upstream, tombstone legacy. */
export async function disconnectGitHubUser(): Promise<GitHubUserConnectionDto> {
  const client = requireDatabaseClient();
  const profileId = await activeProfileId(client);
  await connections(client).disconnectProvider(profileId, 'github');
  return connectionDto(null, client);
}
