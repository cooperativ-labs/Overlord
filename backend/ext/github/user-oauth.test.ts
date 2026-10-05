import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-github-user-oauth-'));
const { bootstrapIntegrationTestDb } = await import('../../test-helpers.ts');
await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'github-user-oauth.sqlite')
});

const { requireDatabaseClient, setActiveProfileId, withRequestContextAsync } =
  await import('../../db.ts');
const {
  beginGitHubUserAuthorization,
  completeGitHubUserAuthorization,
  disconnectGitHubUser,
  getGitHubUserConnection,
  listGitHubRepositoryOwners
} = await import('./user-oauth.ts');

const originalFetch = globalThis.fetch;
const originalEnv = {
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  encryptionKey: process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY,
  authUrl: process.env.BETTER_AUTH_URL
};

test.before(() => {
  process.env.GITHUB_CLIENT_ID = 'shared-oauth-client';
  process.env.GITHUB_CLIENT_SECRET = 'shared-oauth-secret';
  process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url');
  process.env.BETTER_AUTH_URL = 'https://overlord.example';
});

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    const envKey =
      key === 'clientId'
        ? 'GITHUB_CLIENT_ID'
        : key === 'clientSecret'
          ? 'GITHUB_CLIENT_SECRET'
          : key === 'encryptionKey'
            ? 'GITHUB_USER_TOKEN_ENCRYPTION_KEY'
            : 'BETTER_AUTH_URL';
    if (value === undefined) delete process.env[envKey];
    else process.env[envKey] = value;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test('stores encrypted user OAuth credentials and returns only eligible repository owners', async () => {
  const db = requireDatabaseClient();

  const authorization = await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    assert.deepEqual(await getGitHubUserConnection(), {
      configured: true,
      connected: false,
      account: null,
      scopes: []
    });
    return beginGitHubUserAuthorization({ returnTo: 'overlord://github/callback' }, []);
  });

  const authorizationUrl = new URL(authorization.authorizationUrl);
  assert.equal(authorizationUrl.origin, 'https://github.com');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'shared-oauth-client');
  assert.equal(authorizationUrl.searchParams.get('scope'), 'repo read:org');
  assert.equal(
    authorizationUrl.searchParams.get('redirect_uri'),
    'https://overlord.example/api/auth/callback/github/repository'
  );
  assert.equal(authorizationUrl.searchParams.get('allow_signup'), 'false');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorizationUrl.searchParams.get('code_challenge'));
  const state = authorizationUrl.searchParams.get('state');
  assert.ok(state);
  // Since v153 the shared account-connections module holds the hashed, single-use state.
  const stateRow = await db.get<{ state_hash: string; return_url: string | null }>(
    `SELECT state_hash, return_url FROM account_connection_authorizations`
  );
  assert.equal(stateRow?.state_hash, createHash('sha256').update(state).digest('hex'));
  assert.notEqual(stateRow?.state_hash, state);
  assert.equal(stateRow?.return_url, 'overlord://github/callback');

  let exchangeBody: Record<string, string> = {};
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      exchangeBody = JSON.parse(String(init?.body)) as Record<string, string>;
      return Response.json({
        access_token: 'github-access-secret',
        refresh_token: 'github-refresh-secret',
        expires_in: 3600,
        refresh_token_expires_in: 7200,
        scope: 'repo,read:org',
        token_type: 'bearer'
      });
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({
        id: 42,
        login: 'octocat',
        avatar_url: 'https://avatars.example/octocat'
      });
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  };

  const completed = await completeGitHubUserAuthorization({
    code: 'one-time-code',
    state
  });
  assert.equal(completed.returnUrl, 'overlord://github/callback');
  assert.deepEqual(completed.connection, {
    configured: true,
    connected: true,
    account: {
      id: '42',
      login: 'octocat',
      avatarUrl: 'https://avatars.example/octocat'
    },
    scopes: ['repo', 'read:org']
  });
  assert.doesNotMatch(JSON.stringify(completed), /github-(access|refresh)-secret/);
  assert.equal(exchangeBody.client_secret, 'shared-oauth-secret');
  assert.ok(exchangeBody.code_verifier);

  const stored = await db.get<{
    credential_ciphertext: string;
    credential_format: string;
    credential_key_id: string;
    organization_id: string | null;
  }>(
    `SELECT credential_ciphertext, credential_format, credential_key_id, organization_id
       FROM account_connections
      WHERE owner_profile_id = 'operator-user' AND provider = 'github'`
  );
  assert.match(stored?.credential_ciphertext ?? '', /^v1\./);
  assert.equal(stored?.credential_format, 'connection-v1');
  // Only the existing environment key is configured: it is GitHub's write key.
  assert.equal(stored?.credential_key_id, 'github-user-env');
  assert.equal(stored?.organization_id, null);
  assert.doesNotMatch(JSON.stringify(stored), /github-(access|refresh)-secret/);

  await assert.rejects(
    completeGitHubUserAuthorization({ code: 'replayed-code', state }),
    /expired or was already used/
  );

  const observedAuthorizations: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const authorizationHeader = new Headers(init?.headers).get('Authorization');
    if (authorizationHeader) observedAuthorizations.push(authorizationHeader);
    if (url === 'https://api.github.com/user') {
      return Response.json({
        id: 42,
        login: 'octocat',
        avatar_url: 'https://avatars.example/octocat'
      });
    }
    if (url.endsWith('/user/memberships/orgs?state=active&per_page=100')) {
      return Response.json(
        [
          {
            state: 'active',
            role: 'member',
            organization: { login: 'allowed-org', avatar_url: null }
          },
          {
            state: 'active',
            role: 'member',
            organization: { login: 'blocked-org', avatar_url: null }
          }
        ],
        {
          headers: {
            Link: '<https://api.github.com/user/memberships/orgs?state=active&per_page=100&page=2>; rel="next"'
          }
        }
      );
    }
    if (url.endsWith('/user/memberships/orgs?state=active&per_page=100&page=2')) {
      return Response.json([
        {
          state: 'active',
          role: 'admin',
          organization: { login: 'owner-org', avatar_url: null }
        },
        {
          state: 'inactive',
          role: 'admin',
          organization: { login: 'inactive-org', avatar_url: null }
        }
      ]);
    }
    if (url.endsWith('/orgs/allowed-org')) {
      return Response.json({ members_can_create_private_repositories: true });
    }
    if (url.endsWith('/orgs/blocked-org')) {
      return Response.json({ members_can_create_private_repositories: false });
    }
    if (url.endsWith('/orgs/owner-org')) {
      return Response.json({ members_can_create_private_repositories: false });
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  };

  const owners = await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    return listGitHubRepositoryOwners();
  });
  assert.deepEqual(
    owners.map(owner => [owner.login, owner.type]),
    [
      ['octocat', 'personal'],
      ['allowed-org', 'organization'],
      ['owner-org', 'organization']
    ]
  );
  assert.ok(observedAuthorizations.every(value => value === 'Bearer github-access-secret'));

  let revocationUrl = '';
  globalThis.fetch = async input => {
    revocationUrl = String(input);
    return new Response(null, { status: 204 });
  };
  const disconnected = await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    return disconnectGitHubUser();
  });
  assert.equal(disconnected.connected, false);
  assert.equal(revocationUrl, 'https://api.github.com/applications/shared-oauth-client/token');
  const revoked = await db.get<{
    state: string;
    credential_ciphertext: string | null;
    disconnected_at: string | null;
  }>(
    `SELECT state, credential_ciphertext, disconnected_at
       FROM account_connections
      WHERE owner_profile_id = 'operator-user' AND provider = 'github'`
  );
  assert.equal(revoked?.state, 'disconnected');
  assert.equal(revoked?.credential_ciphertext, null);
  assert.ok(revoked?.disconnected_at);
});

async function connectAs(profileId: string, user: { id: number; login: string }) {
  const authorization = await withRequestContextAsync(async () => {
    setActiveProfileId(profileId);
    return beginGitHubUserAuthorization({}, []);
  });
  const state = new URL(authorization.authorizationUrl).searchParams.get('state')!;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token')
      return Response.json({ access_token: `access-${profileId}`, scope: 'repo read:org' });
    if (url === 'https://api.github.com/user') return Response.json({ ...user, avatar_url: null });
    throw new Error(`Unexpected GitHub request: ${url}`);
  };
  await completeGitHubUserAuthorization({ code: 'code', state });
}

test('a token GitHub rejects twice, or a changed identity, requires reconnecting', async () => {
  const db = requireDatabaseClient();
  await connectAs('operator-user', { id: 501, login: 'first' });
  // No refresh token: a 401 forces a refresh that cannot happen, so reconnect is required.
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  await assert.rejects(
    withRequestContextAsync(async () => {
      setActiveProfileId('operator-user');
      return listGitHubRepositoryOwners();
    }),
    /Reconnect GitHub to refresh repository access/
  );
  const rejected = await db.get<{ state: string; credential_ciphertext: string | null }>(
    `SELECT state, credential_ciphertext FROM account_connections
      WHERE owner_profile_id = 'operator-user' AND provider = 'github' AND state <> 'disconnected'`
  );
  assert.deepEqual(
    { ...rejected },
    { state: 'reauthorization_required', credential_ciphertext: null }
  );
  const status = await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    return getGitHubUserConnection();
  });
  // The legacy alias shows the existing reconnect flow.
  assert.deepEqual(status, { configured: true, connected: false, account: null, scopes: [] });

  // Reconnecting reuses the row; then GitHub reports another account for the token.
  await connectAs('operator-user', { id: 501, login: 'first' });
  globalThis.fetch = async input =>
    String(input) === 'https://api.github.com/user'
      ? Response.json({ id: 999, login: 'someone-else' })
      : new Response('{}', { status: 500 });
  await assert.rejects(
    withRequestContextAsync(async () => {
      setActiveProfileId('operator-user');
      return listGitHubRepositoryOwners();
    }),
    /identity changed/
  );
  const changed = await db.get<{ state: string; last_error_code: string }>(
    `SELECT state, last_error_code FROM account_connections
      WHERE owner_profile_id = 'operator-user' AND provider = 'github' AND state <> 'disconnected'`
  );
  assert.deepEqual(
    { ...changed },
    { state: 'reauthorization_required', last_error_code: 'identity_changed' }
  );
});

test('legacy alias sign-in errors keep their messages', async () => {
  await assert.rejects(
    completeGitHubUserAuthorization({ code: 'c', state: 'x'.repeat(43) }),
    /expired or was already used/
  );
  const authorization = await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    return beginGitHubUserAuthorization({ returnTo: 'overlord://github/callback' }, []);
  });
  const state = new URL(authorization.authorizationUrl).searchParams.get('state')!;
  globalThis.fetch = async () => Response.json({ access_token: 'scopeless', scope: 'repo' });
  await assert.rejects(
    completeGitHubUserAuthorization({ code: 'c', state }),
    /did not grant private-repository and organization access/
  );
  await assert.rejects(
    withRequestContextAsync(async () => {
      setActiveProfileId('operator-user');
      return beginGitHubUserAuthorization({ returnTo: 'https://evil.test/' }, []);
    }),
    /not an allowed Overlord destination/
  );
});
