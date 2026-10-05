import { type DatabaseClient } from '@overlord/database';
import express from 'express';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { apiErrorHandler } from '../errors.ts';
import { registerGitHubConnectionProvider } from '../ext/github/connection-provider.ts';
import { conformanceAdapters, createConformanceDatabase } from '../test-helpers.ts';

import { openSecret, sealSecret } from './crypto.ts';
import { createConnectionsRuntime } from './index.ts';
import { keyRingFromEnv } from './keyring.ts';
import { ProfileConnections } from './profile.ts';
import { createConnectionsRouter, createProfileConnectionCallbackHandler } from './routes.ts';
import { ConnectionAccessError } from './service.ts';

/**
 * The personal GitHub repository authorization on the shared account-connections
 * module (coo:1110.ykk0), on both editions: verbatim adoption of tokens written by
 * the pre-v153 code (`20261005130000_account_connections_github_adoption`), the
 * existing environment key, lease-serialised refresh, and the OAuth security
 * properties (explicit `repo read:org` grant, profile- and provider-bound hashed
 * single-use state, one GitHub account per profile, the callback before Better Auth).
 */
const adapters = conformanceAdapters();
const STAMP = '2026-10-04T12:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';
const GITHUB_ENV_KEY = randomBytes(32).toString('base64url');
const CURRENT_KEY = randomBytes(32).toString('base64url');
const LEGACY_ACCESS = `gho_legacy_${randomUUID()}`;
const LEGACY_REFRESH = `ghr_legacy_${randomUUID()}`;

const migrationFile = (dialect: string) =>
  readFileSync(
    new URL(
      `../../database/${dialect}/migrations/20261005130000_account_connections_github_adoption.sql`,
      import.meta.url
    ),
    'utf8'
  );

const savedEnv = {
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL
};
const originalFetch = globalThis.fetch;
before(() => {
  process.env.GITHUB_CLIENT_ID = 'repo-client';
  process.env.GITHUB_CLIENT_SECRET = 'repo-client-secret';
  process.env.BETTER_AUTH_URL = 'https://backend.test';
  registerGitHubConnectionProvider();
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Exactly what the pre-v153 `encryptToken` in `ext/github/user-oauth.ts` wrote. */
function legacyEnvelope(token: string, profileId: string, kind: 'access' | 'refresh') {
  return sealSecret({
    plaintext: token,
    key: Buffer.from(GITHUB_ENV_KEY, 'base64url'),
    aad: `overlord:github-user-oauth:v1:${profileId}:${kind}`
  });
}

interface FakeGitHub {
  calls: { url: string; body: Record<string, string> | null; authorization: string | null }[];
  user: { id: number; login: string };
  tokenResponses: Record<string, unknown>[];
  delayMs: number;
}

/** A fake github.com / api.github.com: token endpoint, `/user`, and token revocation. */
function fakeGitHub(): FakeGitHub {
  const fake: FakeGitHub = {
    calls: [],
    user: { id: 42, login: 'octocat' },
    tokenResponses: [],
    delayMs: 0
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : null;
    const authorization = new Headers(init?.headers).get('Authorization');
    fake.calls.push({ url, body, authorization });
    if (url === 'https://github.com/login/oauth/access_token') {
      if (fake.delayMs) await new Promise(resolve => setTimeout(resolve, fake.delayMs));
      return Response.json(fake.tokenResponses.shift() ?? { error: 'bad_verification_code' });
    }
    if (url === 'https://api.github.com/user')
      return Response.json({ ...fake.user, avatar_url: 'https://avatars.test/octocat' });
    if (url.startsWith('https://api.github.com/applications/'))
      return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url}`);
  };
  return fake;
}

async function seedIdentities(db: DatabaseClient) {
  const bool = db.dialect === 'sqlite' ? '0' : 'FALSE';
  for (const id of ['owner', 'other', 'third'])
    await db.run(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, ${bool}, ?, ?)`,
      [id, id, `${id}@test.invalid`, STAMP, STAMP]
    );
}

async function insertLegacyGitHub(
  db: DatabaseClient,
  input: {
    id: string;
    profileId: string;
    githubUserId?: string;
    accessExpiresAt?: string | null;
    refresh?: boolean;
    deletedAt?: string | null;
  }
) {
  await db.run(
    `INSERT INTO ext_github_user_connections (id, profile_id, github_user_id, github_login, avatar_url, scopes_json, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, refresh_token_expires_at, last_validated_at, created_at, updated_at, deleted_at, revision) VALUES (?, ?, ?, 'octocat', 'https://avatars.test/octocat', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      input.id,
      input.profileId,
      input.githubUserId ?? '42',
      JSON.stringify(['repo', 'read:org']),
      legacyEnvelope(LEGACY_ACCESS, input.profileId, 'access'),
      input.refresh === false ? null : legacyEnvelope(LEGACY_REFRESH, input.profileId, 'refresh'),
      input.accessExpiresAt ?? null,
      input.refresh === false ? null : FUTURE,
      STAMP,
      STAMP,
      STAMP,
      input.deletedAt ?? null
    ]
  );
}

/** A migrated database whose legacy store holds rows the pre-v153 code wrote, then the adoption migration. */
async function migratedWithLegacy(
  db: DatabaseClient,
  options: { accessExpiresAt?: string | null } = {}
) {
  await seedIdentities(db);
  await insertLegacyGitHub(db, {
    id: 'legacy-owner',
    profileId: 'owner',
    accessExpiresAt: options.accessExpiresAt ?? null
  });
  await insertLegacyGitHub(db, {
    id: 'legacy-deleted',
    profileId: 'third',
    githubUserId: '77',
    deletedAt: STAMP
  });
  await db.exec(migrationFile(db.dialect));
}

type Row = Record<string, unknown>;
const githubRow = (db: DatabaseClient, profileId = 'owner') =>
  db.get<Row>(
    "SELECT * FROM account_connections WHERE owner_profile_id = ? AND provider = 'github'",
    [profileId]
  );
const profiles = (db: DatabaseClient, env: NodeJS.ProcessEnv) =>
  new ProfileConnections(db, keyRingFromEnv(env), {
    sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 20)))
  });

/** Start a sign-in and return its raw state from the authorize URL. */
async function startState(store: ProfileConnections, profileId: string) {
  const started = await store.startOAuth(profileId, { provider: 'github', returnTo: 'mobile' });
  const url = new URL(started.authorizeUrl);
  return { started, url, state: url.searchParams.get('state')! };
}

const grant = (scope = 'repo,read:org') => ({
  access_token: `gho_new_${randomUUID()}`,
  refresh_token: `ghr_new_${randomUUID()}`,
  expires_in: 28800,
  refresh_token_expires_in: 15897600,
  scope,
  token_type: 'bearer'
});

for (const adapter of adapters) {
  describe(`GitHub personal authorization on the connections module (${adapter})`, () => {
    it('adopts a legacy row verbatim, keeps the environment key working, and scrubs deleted rows', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      try {
        await migratedWithLegacy(db);
        const row = await githubRow(db);
        assert.equal(row?.id, 'legacy-owner');
        assert.equal(row?.state, 'connected');
        assert.equal(row?.organization_id, null);
        assert.equal(row?.credential_kind, 'oauth');
        assert.equal(row?.credential_format, 'github-user-oauth-v1');
        assert.equal(row?.credential_key_id, 'github-user-env');
        assert.equal(row?.external_account_id, '42');
        assert.equal(row?.external_account_label, 'octocat');
        assert.equal(row?.external_account_avatar_url, 'https://avatars.test/octocat');
        const scopes = row?.granted_scopes_json;
        assert.deepEqual(typeof scopes === 'string' ? JSON.parse(scopes) : scopes, [
          'repo',
          'read:org'
        ]);
        // Soft-deleted legacy rows are not adopted and their ciphertext is scrubbed.
        assert.equal(await githubRow(db, 'third'), undefined);
        const deleted = await db.get<Row>(
          "SELECT access_token_ciphertext, refresh_token_ciphertext FROM ext_github_user_connections WHERE id = 'legacy-deleted'"
        );
        assert.deepEqual(
          { ...deleted },
          { access_token_ciphertext: 'revoked:v1', refresh_token_ciphertext: null }
        );
        // Only the existing GITHUB_USER_TOKEN_ENCRYPTION_KEY: the user stays connected.
        fakeGitHub();
        const token = await profiles(db, {
          GITHUB_USER_TOKEN_ENCRYPTION_KEY: GITHUB_ENV_KEY
        }).oauthAccessToken('owner', 'github');
        assert.equal(token.accessToken, LEGACY_ACCESS);
        assert.equal((await githubRow(db))?.credential_format, 'github-user-oauth-v1');
        // Re-running the migration is a no-op.
        await db.exec(migrationFile(db.dialect));
        assert.equal(
          Number(
            (
              await db.get<{ n: number }>(
                "SELECT COUNT(*) AS n FROM account_connections WHERE provider = 'github'"
              )
            )?.n
          ),
          1
        );
      } finally {
        await cleanup();
      }
    });

    it('re-seals lazily under the current key with the same tokens', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      try {
        await migratedWithLegacy(db);
        fakeGitHub();
        const token = await profiles(db, {
          GITHUB_USER_TOKEN_ENCRYPTION_KEY: GITHUB_ENV_KEY,
          ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: CURRENT_KEY
        }).oauthAccessToken('owner', 'github');
        assert.equal(token.accessToken, LEGACY_ACCESS);
        assert.equal(token.credentialRevision, 2);
        const row = await githubRow(db);
        assert.equal(row?.credential_format, 'connection-v1');
        assert.equal(row?.credential_key_id, 'k1');
        assert.equal(
          openSecret({
            envelope: String(row?.credential_ciphertext),
            key: Buffer.from(CURRENT_KEY, 'base64url'),
            aad: 'overlord:account-connection:v1:owner:-:github:legacy-owner'
          }),
          JSON.stringify({ accessToken: LEGACY_ACCESS, refreshToken: LEGACY_REFRESH })
        );
      } finally {
        await cleanup();
      }
    });

    it('a missing key answers unavailable without erasing; a wrong key requires reconnecting', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      try {
        await migratedWithLegacy(db);
        await assert.rejects(
          profiles(db, {}).oauthAccessToken('owner', 'github'),
          (error: unknown) => error instanceof ConnectionAccessError && error.code === 'unavailable'
        );
        assert.equal((await githubRow(db))?.state, 'connected');
        assert.ok((await githubRow(db))?.credential_ciphertext);
        await assert.rejects(
          profiles(db, {
            GITHUB_USER_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64url')
          }).oauthAccessToken('owner', 'github'),
          (error: unknown) =>
            error instanceof ConnectionAccessError && error.code === 'reauthorization_required'
        );
        const row = await githubRow(db);
        assert.equal(row?.state, 'reauthorization_required');
        assert.equal(row?.credential_ciphertext, null);
        assert.equal(row?.last_error_code, 'credential_unreadable');
      } finally {
        await cleanup();
      }
    });

    it('an expired adopted token is refreshed once for concurrent callers and re-sealed', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      try {
        await migratedWithLegacy(db, { accessExpiresAt: PAST });
        const fake = fakeGitHub();
        const rotated = grant();
        fake.tokenResponses.push(rotated);
        fake.delayMs = 60;
        const env = {
          GITHUB_USER_TOKEN_ENCRYPTION_KEY: GITHUB_ENV_KEY,
          ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: CURRENT_KEY
        };
        // Two instances (distinct lease owners) ask at once.
        const [first, second] = await Promise.all([
          profiles(db, env).oauthAccessToken('owner', 'github'),
          profiles(db, env).oauthAccessToken('owner', 'github')
        ]);
        const refreshes = fake.calls.filter(
          call => call.url === 'https://github.com/login/oauth/access_token'
        );
        assert.equal(refreshes.length, 1);
        assert.deepEqual(refreshes[0]?.body, {
          client_id: 'repo-client',
          client_secret: 'repo-client-secret',
          grant_type: 'refresh_token',
          refresh_token: LEGACY_REFRESH
        });
        assert.equal(first.accessToken, rotated.access_token);
        assert.equal(second.accessToken, rotated.access_token);
        const row = await githubRow(db);
        assert.equal(row?.credential_format, 'connection-v1');
        assert.equal(row?.credential_key_id, 'k1');
        assert.equal(row?.refresh_lock_owner, null);
        assert.ok(Date.parse(String(row?.access_expires_at)) > Date.now());
        assert.equal(
          openSecret({
            envelope: String(row?.credential_ciphertext),
            key: Buffer.from(CURRENT_KEY, 'base64url'),
            aad: 'overlord:account-connection:v1:owner:-:github:legacy-owner'
          }),
          JSON.stringify({
            accessToken: rotated.access_token,
            refreshToken: rotated.refresh_token
          })
        );
      } finally {
        await cleanup();
      }
    });

    it('a refused refresh, or an expired token without one, requires reconnecting', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      try {
        await migratedWithLegacy(db, { accessExpiresAt: PAST });
        const fake = fakeGitHub();
        fake.tokenResponses.push({ error: 'bad_refresh_token' });
        const env = { GITHUB_USER_TOKEN_ENCRYPTION_KEY: GITHUB_ENV_KEY };
        await assert.rejects(
          profiles(db, env).oauthAccessToken('owner', 'github'),
          (error: unknown) =>
            error instanceof ConnectionAccessError && error.code === 'reauthorization_required'
        );
        const row = await githubRow(db);
        assert.equal(row?.state, 'reauthorization_required');
        assert.equal(row?.last_error_code, 'invalid_grant');
        assert.equal(row?.credential_ciphertext, null);
        // A stale-revision call on a token without a refresh token cannot refresh either.
        await insertLegacyGitHub(db, {
          id: 'legacy-other',
          profileId: 'other',
          githubUserId: '43',
          refresh: false
        });
        const store = profiles(db, env);
        const token = await store.oauthAccessToken('other', 'github');
        await assert.rejects(
          store.oauthAccessToken('other', 'github', { staleRevision: token.credentialRevision }),
          (error: unknown) =>
            error instanceof ConnectionAccessError && error.code === 'reauthorization_required'
        );
        assert.equal((await githubRow(db, 'other'))?.last_error_code, 'grant_expired');
      } finally {
        await cleanup();
      }
    });

    it('state is hashed, single-use, bound to its profile and provider', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      try {
        await seedIdentities(db);
        const fake = fakeGitHub();
        const store = profiles(db, { GITHUB_USER_TOKEN_ENCRYPTION_KEY: GITHUB_ENV_KEY });
        const { url, state, started } = await startState(store, 'owner');
        assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
        assert.equal(url.searchParams.get('scope'), 'repo read:org');
        assert.equal(url.searchParams.get('allow_signup'), 'false');
        assert.equal(
          url.searchParams.get('redirect_uri'),
          'https://backend.test/api/auth/callback/github/repository'
        );
        const stored = await db.get<Row>(
          'SELECT state_hash, pkce_verifier_ciphertext FROM account_connection_authorizations'
        );
        assert.equal(stored?.state_hash, createHash('sha256').update(state).digest('hex'));
        assert.match(String(stored?.pkce_verifier_ciphertext), /^v1\./);
        // A state issued on another provider's connection is never consumed by GitHub's callback.
        const foreignState = randomBytes(32).toString('base64url');
        await db.run(
          "INSERT INTO account_connections (id, owner_profile_id, provider, server_url, state, credential_kind, created_at, updated_at) VALUES ('ev', 'owner', 'everhour', 'https://api.everhour.com', 'pending', 'api_key', ?, ?)",
          [STAMP, STAMP]
        );
        await db.run(
          "INSERT INTO account_connection_authorizations (id, connection_id, state_hash, pkce_verifier_ciphertext, return_to, expires_at, created_at) VALUES ('ev-auth', 'ev', ?, 'v1.a.b.c', 'web', ?, ?)",
          [createHash('sha256').update(foreignState).digest('hex'), FUTURE, STAMP]
        );
        assert.equal(
          (await store.completeOAuth('github', { code: 'c', state: foreignState })).status,
          'expired'
        );
        assert.equal(
          (
            await db.get<Row>(
              "SELECT consumed_at FROM account_connection_authorizations WHERE id = 'ev-auth'"
            )
          )?.consumed_at,
          null
        );
        fake.tokenResponses.push(grant());
        const done = await store.completeOAuth('github', { code: 'code-1', state });
        assert.equal(done.status, 'connected');
        assert.equal(done.connectionId, started.connectionId);
        assert.equal(done.returnTo, 'mobile');
        const exchange = fake.calls.find(
          call => call.url === 'https://github.com/login/oauth/access_token'
        );
        assert.ok(exchange?.body?.code_verifier);
        assert.equal(exchange?.body?.code, 'code-1');
        // The token attaches to the profile that started the sign-in, never another.
        assert.equal((await githubRow(db))?.state, 'connected');
        assert.equal(await githubRow(db, 'other'), undefined);
        // Replay: expired, and nothing is exchanged.
        const before = fake.calls.length;
        assert.equal(
          (await store.completeOAuth('github', { code: 'code-2', state })).status,
          'expired'
        );
        assert.equal(fake.calls.length, before);
        assert.equal(
          (await store.completeOAuth('github', { code: 'x', state: 'short' })).status,
          'expired'
        );
      } finally {
        await cleanup();
      }
    });

    it('a grant without read:org stores nothing; one GitHub account cannot serve two profiles', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      try {
        await migratedWithLegacy(db);
        const fake = fakeGitHub();
        const store = profiles(db, { GITHUB_USER_TOKEN_ENCRYPTION_KEY: GITHUB_ENV_KEY });
        const missing = await startState(store, 'other');
        fake.tokenResponses.push(grant('repo'));
        const outcome = await store.completeOAuth('github', { code: 'c', state: missing.state });
        assert.deepEqual([outcome.status, outcome.errorCode], ['failed', 'insufficient_scope']);
        let row = await githubRow(db, 'other');
        assert.equal(row?.state, 'pending');
        assert.equal(row?.credential_ciphertext, null);
        assert.equal(row?.last_error_code, 'insufficient_scope');
        // GitHub user 42 is already live on `owner` (adopted).
        const second = await startState(store, 'other');
        fake.tokenResponses.push(grant());
        const taken = await store.completeOAuth('github', { code: 'c', state: second.state });
        assert.deepEqual([taken.status, taken.errorCode], ['failed', 'account_in_use']);
        row = await githubRow(db, 'other');
        assert.equal(row?.credential_ciphertext, null);
        // A user who denies access at GitHub.
        const denied = await startState(store, 'other');
        assert.equal(
          (await store.completeOAuth('github', { state: denied.state, error: 'access_denied' }))
            .status,
          'denied'
        );
      } finally {
        await cleanup();
      }
    });

    it('disconnect erases, revokes, and tombstones; nothing resurrects it', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      try {
        await migratedWithLegacy(db);
        const fake = fakeGitHub();
        const store = profiles(db, { GITHUB_USER_TOKEN_ENCRYPTION_KEY: GITHUB_ENV_KEY });
        await store.disconnectProvider('owner', 'github');
        const row = await githubRow(db);
        assert.equal(row?.state, 'disconnected');
        assert.equal(row?.credential_ciphertext, null);
        const revocation = fake.calls.find(call => call.url.includes('/applications/'));
        assert.equal(revocation?.url, 'https://api.github.com/applications/repo-client/token');
        assert.deepEqual(revocation?.body, { access_token: LEGACY_ACCESS });
        assert.match(String(revocation?.authorization), /^Basic /);
        const legacy = await db.get<Row>(
          "SELECT access_token_ciphertext, refresh_token_ciphertext, deleted_at FROM ext_github_user_connections WHERE id = 'legacy-owner'"
        );
        assert.equal(legacy?.access_token_ciphertext, 'revoked:v1');
        assert.equal(legacy?.refresh_token_ciphertext, null);
        assert.ok(legacy?.deleted_at);
        await db.exec(migrationFile(db.dialect));
        assert.equal(await store.find('owner', 'github'), null);
        await assert.rejects(
          store.oauthAccessToken('owner', 'github'),
          (error: unknown) => error instanceof ConnectionAccessError && error.code === 'not_found'
        );
      } finally {
        await cleanup();
      }
    });

    it('adopts a row an older instance wrote after the migration, honouring its later disconnect', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      try {
        await migratedWithLegacy(db);
        fakeGitHub();
        const store = profiles(db, { GITHUB_USER_TOKEN_ENCRYPTION_KEY: GITHUB_ENV_KEY });
        await insertLegacyGitHub(db, { id: 'legacy-late', profileId: 'other', githubUserId: '43' });
        assert.equal((await store.oauthAccessToken('other', 'github')).accessToken, LEGACY_ACCESS);
        await db.run(
          "UPDATE ext_github_user_connections SET deleted_at = ? WHERE id = 'legacy-late'",
          [STAMP]
        );
        await assert.rejects(
          store.oauthAccessToken('other', 'github'),
          (error: unknown) => error instanceof ConnectionAccessError && error.code === 'not_found'
        );
        assert.equal((await githubRow(db, 'other'))?.state, 'disconnected');
      } finally {
        await cleanup();
      }
    });

    it('serves the GitHub start route and callback on Local and never exposes a token', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      const logged: string[] = [];
      const originals = {
        log: console.log,
        info: console.info,
        error: console.error,
        warn: console.warn
      };
      for (const method of ['log', 'info', 'error', 'warn'] as const)
        console[method] = (...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        };
      try {
        await migratedWithLegacy(db);
        const fake = fakeGitHub();
        const runtime = createConnectionsRuntime({
          db,
          env: { GITHUB_USER_TOKEN_ENCRYPTION_KEY: GITHUB_ENV_KEY },
          publicBaseUrl: 'https://backend.test',
          webReturnOrigin: 'https://app.test'
        });
        const app = express();
        app.use(express.json());
        // Mounted exactly as backend/index.ts does: the provider callback before the wildcard.
        app.get(
          '/api/auth/callback/github/repository',
          createProfileConnectionCallbackHandler({ provider: 'github', runtime: () => runtime })
        );
        app.all('/api/auth/*', (_req, res) => {
          res.status(418).send('better-auth');
        });
        app.use(
          '/api/connections',
          createConnectionsRouter({
            cloud: () => false,
            runtime: () => runtime,
            owner: () => null,
            profile: () => 'other'
          })
        );
        app.use(apiErrorHandler);
        const server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const bodies: string[] = [];
        const call = async (method: string, path: string, body?: unknown) => {
          const response = await originalFetch(`${base}${path}`, {
            method,
            redirect: 'manual',
            headers: body ? { 'content-type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined
          });
          const text = await response.text();
          bodies.push(text, response.headers.get('location') ?? '');
          return { status: response.status, text, location: response.headers.get('location') };
        };
        try {
          const listed = JSON.parse((await call('GET', '/api/connections?scope=all')).text);
          assert.deepEqual(
            listed.providers.find((p: { provider: string }) => p.provider === 'github'),
            {
              provider: 'github',
              scope: 'profile',
              credentialKind: 'oauth',
              available: true,
              reason: null
            }
          );
          assert.equal(
            (
              await call('POST', '/api/connections', {
                provider: 'github',
                returnTo: 'web',
                returnPath: '//evil.test'
              })
            ).status,
            400
          );
          const start = await call('POST', '/api/connections', {
            provider: 'github',
            returnTo: 'web',
            returnPath: '/projects/new'
          });
          assert.equal(start.status, 200);
          const state = new URL(JSON.parse(start.text).authorizeUrl).searchParams.get('state')!;
          fake.user = { id: 43, login: 'hubot' };
          const tokens = grant();
          fake.tokenResponses.push(tokens);
          const callback = await call(
            'GET',
            `/api/auth/callback/github/repository?code=one-time&state=${state}`
          );
          assert.equal(callback.status, 302);
          assert.equal(
            callback.location,
            'https://app.test/projects/new?provider=github&status=connected'
          );
          // Replay lands back with the expired status, still served before the wildcard.
          const replay = await call(
            'GET',
            `/api/auth/callback/github/repository?code=one-time&state=${state}`
          );
          assert.equal(replay.status, 302);
          assert.match(String(replay.location), /status=expired/);
          const unknown = await call(
            'GET',
            `/api/auth/callback/github/repository?state=${'x'.repeat(43)}`
          );
          assert.equal(unknown.status, 400);
          assert.match(unknown.text, /expired or was already used/);
          const all = JSON.parse((await call('GET', '/api/connections?scope=all')).text);
          const github = all.items.find((item: { provider: string }) => item.provider === 'github');
          assert.equal(github.state, 'connected');
          assert.deepEqual(github.account, {
            id: '43',
            label: 'hubot',
            avatarUrl: 'https://avatars.test/octocat'
          });
          assert.deepEqual(github.scopes, ['repo', 'read:org']);
          assert.equal((await call('DELETE', `/api/connections/${github.id}`)).status, 200);

          const exposures = [
            ...bodies,
            ...logged,
            JSON.stringify(await db.all('SELECT * FROM entity_changes')),
            JSON.stringify(await db.all('SELECT * FROM outbox_messages')),
            JSON.stringify(await db.all('SELECT * FROM account_connections')),
            JSON.stringify(await db.all('SELECT * FROM account_connection_authorizations'))
          ].join('\n');
          for (const secret of [
            tokens.access_token,
            tokens.refresh_token,
            LEGACY_ACCESS,
            LEGACY_REFRESH
          ])
            assert.ok(!exposures.includes(secret), 'a credential leaked');
          // The raw state appears only in `authorizeUrl`, where OAuth requires it.
          assert.equal(
            exposures.split(state).length - 1,
            1,
            'the raw state appears outside authorizeUrl'
          );
          assert.ok(start.text.includes(state));
        } finally {
          server.close();
        }
      } finally {
        Object.assign(console, originals);
        await cleanup();
      }
    });

    it('without any key or OAuth client GitHub is unavailable and starting answers 503', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'github_connections');
      try {
        await migratedWithLegacy(db);
        const store = profiles(db, {});
        assert.equal(
          store.providers().find(p => p.provider === 'github')?.reason,
          'encryption_not_configured'
        );
        await assert.rejects(
          store.startOAuth('other', { provider: 'github', returnTo: 'web' }),
          (error: unknown) => (error as { code?: string }).code === 'provider_not_ready'
        );
        const clientId = process.env.GITHUB_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_ID;
        try {
          assert.equal(
            profiles(db, { GITHUB_USER_TOKEN_ENCRYPTION_KEY: GITHUB_ENV_KEY })
              .providers()
              .find(p => p.provider === 'github')?.reason,
            'not_configured'
          );
        } finally {
          process.env.GITHUB_CLIENT_ID = clientId;
        }
        // Stored metadata still lists.
        assert.deepEqual(
          (await store.list('owner')).map(item => item.id),
          ['legacy-owner']
        );
      } finally {
        await cleanup();
      }
    });
  });
}

it('backend/index.ts mounts the GitHub repository callback before the Better Auth wildcard', () => {
  const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const callback = source.indexOf('GITHUB_REPOSITORY_CALLBACK_PATH,\n');
  const wildcard = source.indexOf("app.all('/api/auth/*'");
  assert.ok(callback > 0 && wildcard > 0 && callback < wildcard);
  assert.match(
    source,
    /app\.get\(\s*GITHUB_REPOSITORY_CALLBACK_PATH,\s*createProfileConnectionCallbackHandler\(\{ provider: 'github'/
  );
});
