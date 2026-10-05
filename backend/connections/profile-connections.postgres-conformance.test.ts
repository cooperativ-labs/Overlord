import { type DatabaseClient } from '@overlord/database';
import express from 'express';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { apiErrorHandler } from '../errors.ts';
import { conformanceAdapters, createConformanceDatabase } from '../test-helpers.ts';

import { openSecret, sealSecret } from './crypto.ts';
import { createConnectionsRuntime } from './index.ts';
import { keyRingFromEnv } from './keyring.ts';
import {
  ProfileConnections,
  ProviderCredentialError,
  registerProfileConnectionProvider
} from './profile.ts';
import { createConnectionsRouter } from './routes.ts';
import { ConnectionAccessError } from './service.ts';

/**
 * Profile-scoped account connections and the v153 migration (coo:1110.j8ny), on
 * both editions. Each test rewinds a fully migrated database to the v152
 * `account_connections` shape, seeds rows exactly as the pre-v153 code wrote them,
 * and then runs the real `20261005120000_account_connections_profile_scope`
 * migration file.
 */
const adapters = conformanceAdapters();
const STAMP = '2026-10-04T12:00:00.000Z';
const EVERHOUR_ENV_KEY = randomBytes(32).toString('base64url');
const CURRENT_KEY = randomBytes(32).toString('base64url');
const API_KEY = `everhour-secret-${randomUUID()}`;

const migrationFile = (dialect: string) =>
  readFileSync(
    new URL(
      `../../database/${dialect}/migrations/20261005120000_account_connections_profile_scope.sql`,
      import.meta.url
    ),
    'utf8'
  );
const v152Sqlite = readFileSync(
  new URL(
    '../../database/sqlite/migrations/20261004120000_chat_conversations.sql',
    import.meta.url
  ),
  'utf8'
);
/** The v152 `account_connections` DDL and its indexes, verbatim from the v152 migration. */
const v152SqliteAccountConnections = v152Sqlite.slice(
  v152Sqlite.indexOf('CREATE TABLE account_connections ('),
  v152Sqlite.indexOf('CREATE TABLE account_connection_authorizations')
);
/** The verbatim-copy statement of the v153 migration, to prove re-running it is safe. */
const copyStatement = (dialect: string) => {
  const sql = migrationFile(dialect);
  return sql.slice(sql.indexOf('INSERT INTO account_connections ('), sql.indexOf('-- Scrub'));
};

/** Exactly what the pre-v153 `encryptEverhourApiKey` wrote. */
function legacyEverhourEnvelope(apiKey: string, profileId: string, encodedKey: string) {
  return sealSecret({
    plaintext: apiKey,
    key: Buffer.from(encodedKey, 'base64url'),
    aad: `overlord:everhour-user-key:v1:${profileId}:api-key`
  });
}

registerProfileConnectionProvider({
  provider: 'everhour',
  serverUrl: 'https://api.everhour.com',
  credentialKind: 'api_key',
  validateApiKey: async apiKey => {
    if (apiKey === 'rejected-key') throw new ProviderCredentialError('rejected', 401);
    if (apiKey === 'unreachable-key') throw new ProviderCredentialError('unavailable');
    return { id: '7', label: 'Everhour Operator' };
  },
  legacy: {
    find: async (db, profileId) => {
      const row = await db.get<{
        id: string;
        api_key_ciphertext: string;
        account_id: string | null;
        account_name: string | null;
        last_validated_at: string;
        created_at: string;
        updated_at: string;
      }>(
        'SELECT * FROM ext_everhour_user_connections WHERE profile_id = ? AND deleted_at IS NULL',
        [profileId]
      );
      return row
        ? {
            id: row.id,
            ciphertext: row.api_key_ciphertext,
            format: 'everhour-user-key-v1',
            keyId: 'everhour-env',
            account: { id: row.account_id, label: row.account_name },
            lastValidatedAt: row.last_validated_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          }
        : null;
    },
    isLive: async (db, id) =>
      Boolean(
        await db.get(
          'SELECT 1 AS present FROM ext_everhour_user_connections WHERE id = ? AND deleted_at IS NULL',
          [id]
        )
      ),
    tombstone: async (db, profileId, at) => {
      await db.run(
        "UPDATE ext_everhour_user_connections SET deleted_at = ?, updated_at = ?, api_key_ciphertext = 'revoked:v1', revision = revision + 1 WHERE profile_id = ? AND deleted_at IS NULL",
        [at, at, profileId]
      );
    }
  }
});

/** Put `account_connections` back to its v152 shape (the state the v153 migration meets). */
async function rewindToV152(db: DatabaseClient) {
  if (db.dialect === 'sqlite') {
    await db.exec(`PRAGMA foreign_keys = OFF;
      DROP TABLE account_connections;
      ${v152SqliteAccountConnections}
      ALTER TABLE account_connection_authorizations DROP COLUMN return_url;
      PRAGMA foreign_keys = ON;`);
    return;
  }
  await db.exec(`
    DROP INDEX idx_account_connections_profile_live;
    DROP INDEX idx_account_connections_github_account_live;
    ALTER TABLE account_connections
      DROP CONSTRAINT account_connections_provider_check,
      DROP CONSTRAINT account_connections_scope_check,
      DROP COLUMN credential_kind,
      DROP COLUMN credential_format,
      DROP COLUMN external_account_id,
      DROP COLUMN external_account_label,
      DROP COLUMN external_account_avatar_url,
      DROP COLUMN granted_scopes_json,
      DROP COLUMN last_validated_at,
      ALTER COLUMN organization_id SET NOT NULL,
      ADD CHECK (provider IN ('knowledgebase'));
    ALTER TABLE account_connection_authorizations DROP COLUMN return_url;`);
}

async function seedIdentities(db: DatabaseClient) {
  const bool = db.dialect === 'sqlite' ? '0' : 'FALSE';
  for (const id of ['owner', 'other', 'gone'])
    await db.run(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, ${bool}, ?, ?)`,
      [id, id, `${id}@test.invalid`, STAMP, STAMP]
    );
  await db.run('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    'org',
    'org',
    STAMP,
    STAMP
  ]);
  await db.run(
    "INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at) VALUES ('ws', 'org', 'ws', 'ws', 'hosted', ?, ?)",
    [STAMP, STAMP]
  );
  await db.run(
    "INSERT INTO workspace_users (id, workspace_id, profile_id, member_key, status, created_at, updated_at) VALUES ('m1', 'ws', 'owner', 'owner-ws', 'active', ?, ?)",
    [STAMP, STAMP]
  );
}

async function insertLegacyEverhour(
  db: DatabaseClient,
  id: string,
  profileId: string,
  envelope: string,
  deletedAt: string | null = null
) {
  await db.run(
    'INSERT INTO ext_everhour_user_connections (id, profile_id, api_key_ciphertext, account_id, account_name, last_validated_at, created_at, updated_at, deleted_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [id, profileId, envelope, '7', 'Everhour Operator', STAMP, STAMP, STAMP, deletedAt]
  );
}

/** A v152 database with one Knowledgebase connection, legacy Everhour rows, then v153. */
async function migratedWithLegacy(db: DatabaseClient) {
  await rewindToV152(db);
  await seedIdentities(db);
  await db.run(
    `INSERT INTO account_connections (id, owner_profile_id, organization_id, provider, server_url, state, credential_ciphertext, credential_key_id, credential_revision, created_at, updated_at) VALUES ('kb1', 'owner', 'org', 'knowledgebase', 'https://kb.test/mcp', 'connected', 'v1.x.y.z', 'k1', 1, ?, ?)`,
    [STAMP, STAMP]
  );
  await db.run(
    "INSERT INTO account_connection_authorizations (id, connection_id, state_hash, pkce_verifier_ciphertext, return_to, expires_at, created_at) VALUES ('auth1', 'kb1', 'hash', 'v1.a.b.c', 'web', ?, ?)",
    [STAMP, STAMP]
  );
  await db.run(
    'INSERT INTO chat_threads (id, owner_profile_id, organization_id, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['t1', 'owner', 'org', STAMP, STAMP, STAMP]
  );
  await db.run(
    "INSERT INTO chat_source_refs (id, thread_id, source_kind, scope_key, connection_id, locator_json, access_state, access_checked_at, created_at, updated_at) VALUES ('ref1', 't1', 'knowledgebase', 'kb:n1', 'kb1', '{}', 'authorized', ?, ?, ?)",
    [STAMP, STAMP, STAMP]
  );
  await insertLegacyEverhour(
    db,
    'legacy-owner',
    'owner',
    legacyEverhourEnvelope(API_KEY, 'owner', EVERHOUR_ENV_KEY)
  );
  await insertLegacyEverhour(
    db,
    'legacy-gone',
    'gone',
    legacyEverhourEnvelope('deleted-secret', 'gone', EVERHOUR_ENV_KEY),
    STAMP
  );
  await db.run(
    "INSERT INTO ext_everhour_workspace_connections (id, workspace_id, api_key_secret, created_at, updated_at, deleted_at, revision) VALUES ('wsk', 'ws', 'adopted-plaintext', ?, ?, ?, 1)",
    [STAMP, STAMP, STAMP]
  );
  await db.exec(migrationFile(db.dialect));
}

const profiles = (db: DatabaseClient, env: NodeJS.ProcessEnv) =>
  new ProfileConnections(db, keyRingFromEnv(env));

type Row = Record<string, unknown>;
const everhourRow = (db: DatabaseClient, profileId = 'owner') =>
  db.get<Row>(
    "SELECT * FROM account_connections WHERE owner_profile_id = ? AND provider = 'everhour'",
    [profileId]
  );

for (const adapter of adapters) {
  describe(`v153 account-connections migration (${adapter})`, () => {
    it('rebuilds account_connections preserving Knowledgebase rows and links', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
      try {
        await migratedWithLegacy(db);
        const kb = await db.get<Row>("SELECT * FROM account_connections WHERE id = 'kb1'");
        assert.equal(kb?.organization_id, 'org');
        assert.equal(kb?.credential_format, 'connection-v1');
        assert.equal(kb?.credential_kind, 'oauth');
        assert.equal(kb?.credential_ciphertext, 'v1.x.y.z');
        assert.equal(
          (await db.get<Row>("SELECT connection_id FROM chat_source_refs WHERE id = 'ref1'"))
            ?.connection_id,
          'kb1'
        );
        if (db.dialect === 'sqlite') assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
        // Foreign-key actions still bind to the rebuilt table.
        await db.run("DELETE FROM account_connections WHERE id = 'kb1'");
        assert.equal(
          await db.get("SELECT 1 AS x FROM account_connection_authorizations WHERE id = 'auth1'"),
          undefined
        );
        assert.equal(
          (await db.get<Row>("SELECT connection_id FROM chat_source_refs WHERE id = 'ref1'"))
            ?.connection_id,
          null
        );
        // Scope is tied to the provider in the database.
        await assert.rejects(
          db.run(
            "INSERT INTO account_connections (id, owner_profile_id, organization_id, provider, server_url, state, created_at, updated_at) VALUES ('bad1', 'owner', NULL, 'knowledgebase', 'https://kb.test', 'pending', ?, ?)",
            [STAMP, STAMP]
          )
        );
        await assert.rejects(
          db.run(
            "INSERT INTO account_connections (id, owner_profile_id, organization_id, provider, server_url, state, created_at, updated_at) VALUES ('bad2', 'owner', 'org', 'everhour', 'https://api.everhour.com', 'pending', ?, ?)",
            [STAMP, STAMP]
          )
        );
      } finally {
        await cleanup();
      }
    });

    it('copies live Everhour envelopes verbatim and scrubs deleted secrets', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
      try {
        await migratedWithLegacy(db);
        const legacy = await db.get<Row>(
          "SELECT api_key_ciphertext FROM ext_everhour_user_connections WHERE id = 'legacy-owner'"
        );
        const row = await everhourRow(db);
        assert.equal(row?.id, 'legacy-owner');
        assert.equal(row?.organization_id, null);
        assert.equal(row?.state, 'connected');
        assert.equal(row?.credential_kind, 'api_key');
        assert.equal(row?.credential_format, 'everhour-user-key-v1');
        assert.equal(row?.credential_key_id, 'everhour-env');
        assert.equal(row?.credential_ciphertext, legacy?.api_key_ciphertext);
        assert.equal(row?.external_account_id, '7');
        assert.equal(row?.external_account_label, 'Everhour Operator');
        assert.equal(row?.last_validated_at, STAMP);
        // Soft-deleted legacy rows are neither copied nor left holding a secret.
        assert.equal(await everhourRow(db, 'gone'), undefined);
        assert.equal(
          (
            await db.get<Row>(
              "SELECT api_key_ciphertext FROM ext_everhour_user_connections WHERE id = 'legacy-gone'"
            )
          )?.api_key_ciphertext,
          'revoked:v1'
        );
        assert.equal(
          (
            await db.get<Row>(
              "SELECT api_key_secret FROM ext_everhour_workspace_connections WHERE id = 'wsk'"
            )
          )?.api_key_secret,
          'revoked:v1'
        );
      } finally {
        await cleanup();
      }
    });

    it('keeps the existing environment key working, including the GitHub fallback', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
      try {
        await migratedWithLegacy(db);
        for (const env of [
          { EVERHOUR_API_KEY_ENCRYPTION_KEY: EVERHOUR_ENV_KEY },
          { GITHUB_USER_TOKEN_ENCRYPTION_KEY: EVERHOUR_ENV_KEY }
        ]) {
          const found = await profiles(db, env).credential('owner', 'everhour');
          assert.deepEqual(found?.credential, { kind: 'api_key', apiKey: API_KEY });
        }
        // No current key: nothing is re-sealed.
        const row = await everhourRow(db);
        assert.equal(row?.credential_format, 'everhour-user-key-v1');
        assert.equal(row?.credential_revision, 1);
      } finally {
        await cleanup();
      }
    });

    it('re-seals lazily under the current key with the same plaintext', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
      try {
        await migratedWithLegacy(db);
        const env = {
          EVERHOUR_API_KEY_ENCRYPTION_KEY: EVERHOUR_ENV_KEY,
          ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: CURRENT_KEY
        };
        assert.equal(
          (await profiles(db, env).credential('owner', 'everhour'))?.credential.kind,
          'api_key'
        );
        const row = await everhourRow(db);
        assert.equal(row?.credential_format, 'connection-v1');
        assert.equal(row?.credential_key_id, 'k1');
        assert.equal(row?.credential_revision, 2);
        assert.equal(
          openSecret({
            envelope: String(row?.credential_ciphertext),
            key: Buffer.from(CURRENT_KEY, 'base64url'),
            aad: 'overlord:account-connection:v1:owner:-:everhour:legacy-owner'
          }),
          JSON.stringify({ apiKey: API_KEY })
        );
        // Readable with only the current key once re-sealed.
        const found = await profiles(db, {
          ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: CURRENT_KEY
        }).credential('owner', 'everhour');
        assert.deepEqual(found?.credential, { kind: 'api_key', apiKey: API_KEY });
        assert.equal((await everhourRow(db))?.credential_revision, 2);
      } finally {
        await cleanup();
      }
    });

    it('the startup sweep re-seals remaining legacy rows and reports counts', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
      try {
        await migratedWithLegacy(db);
        const store = profiles(db, {
          EVERHOUR_API_KEY_ENCRYPTION_KEY: EVERHOUR_ENV_KEY,
          ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: CURRENT_KEY
        });
        assert.deepEqual(await store.resealSweep(), { resealed: 1, remaining: 0 });
        assert.deepEqual(await store.resealSweep(), { resealed: 0, remaining: 0 });
        assert.equal((await everhourRow(db))?.credential_format, 'connection-v1');
      } finally {
        await cleanup();
      }
    });

    it('a missing key answers unavailable without erasing; a wrong key requires reconnecting', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
      try {
        await migratedWithLegacy(db);
        await assert.rejects(
          profiles(db, {}).credential('owner', 'everhour'),
          (error: unknown) => error instanceof ConnectionAccessError && error.code === 'unavailable'
        );
        assert.equal((await everhourRow(db))?.state, 'connected');
        assert.ok((await everhourRow(db))?.credential_ciphertext);
        // Present but wrong: real corruption or a rotated key.
        await assert.rejects(
          profiles(db, {
            EVERHOUR_API_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64url')
          }).credential('owner', 'everhour'),
          (error: unknown) =>
            error instanceof ConnectionAccessError && error.code === 'reauthorization_required'
        );
        const row = await everhourRow(db);
        assert.equal(row?.state, 'reauthorization_required');
        assert.equal(row?.credential_ciphertext, null);
        assert.equal(row?.last_error_code, 'credential_unreadable');
      } finally {
        await cleanup();
      }
    });

    it('disconnect tombstones the legacy row and nothing resurrects it', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
      try {
        await migratedWithLegacy(db);
        const store = profiles(db, { EVERHOUR_API_KEY_ENCRYPTION_KEY: EVERHOUR_ENV_KEY });
        const dto = await store.disconnect('owner', 'legacy-owner');
        assert.equal(dto.state, 'disconnected');
        const legacy = await db.get<Row>(
          "SELECT api_key_ciphertext, deleted_at FROM ext_everhour_user_connections WHERE id = 'legacy-owner'"
        );
        assert.equal(legacy?.api_key_ciphertext, 'revoked:v1');
        assert.ok(legacy?.deleted_at);
        // Re-running the migration's copy and lazy adoption both leave it disconnected.
        await db.exec(copyStatement(db.dialect));
        assert.equal(await store.find('owner', 'everhour'), null);
        assert.equal(await store.credential('owner', 'everhour'), null);
        const row = await everhourRow(db);
        assert.equal(row?.state, 'disconnected');
        assert.equal(row?.credential_ciphertext, null);
      } finally {
        await cleanup();
      }
    });

    it('adopts a legacy row written after the migration and honours a later legacy disconnect', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
      try {
        await migratedWithLegacy(db);
        const store = profiles(db, { EVERHOUR_API_KEY_ENCRYPTION_KEY: EVERHOUR_ENV_KEY });
        // An older instance (deploy overlap) writes a key for a profile with no row.
        await insertLegacyEverhour(
          db,
          'legacy-other',
          'other',
          legacyEverhourEnvelope('other-secret', 'other', EVERHOUR_ENV_KEY)
        );
        assert.equal((await store.find('other', 'everhour'))?.id, 'legacy-other');
        assert.deepEqual((await store.credential('other', 'everhour'))?.credential, {
          kind: 'api_key',
          apiKey: 'other-secret'
        });
        // The older instance then disconnects in its own store: the copy is not honoured.
        await db.run(
          "UPDATE ext_everhour_user_connections SET deleted_at = ? WHERE id = 'legacy-other'",
          [STAMP]
        );
        assert.equal(await store.credential('other', 'everhour'), null);
        const row = await everhourRow(db, 'other');
        assert.equal(row?.state, 'disconnected');
        assert.equal(row?.credential_ciphertext, null);
      } finally {
        await cleanup();
      }
    });

    it('an envelope copied to another owner fails authentication', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
      try {
        await migratedWithLegacy(db);
        const stolen = await everhourRow(db);
        await db.run(
          "INSERT INTO account_connections (id, owner_profile_id, provider, server_url, state, credential_kind, credential_format, credential_ciphertext, credential_key_id, created_at, updated_at) VALUES ('copy', 'other', 'everhour', 'https://api.everhour.com', 'connected', 'api_key', 'everhour-user-key-v1', ?, 'everhour-env', ?, ?)",
          [stolen?.credential_ciphertext, STAMP, STAMP]
        );
        const store = new ProfileConnections(
          db,
          keyRingFromEnv({ EVERHOUR_API_KEY_ENCRYPTION_KEY: EVERHOUR_ENV_KEY })
        );
        // Only the legacy-source check would stop a copy whose source is gone; with a live
        // source id it must still fail on the binding.
        await insertLegacyEverhour(db, 'copy', 'other', 'v1.unused.unused.unused');
        await assert.rejects(
          store.credential('other', 'everhour'),
          (error: unknown) =>
            error instanceof ConnectionAccessError && error.code === 'reauthorization_required'
        );
      } finally {
        await cleanup();
      }
    });

    it('serves profile-scoped routes on Local and never echoes or records the key', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
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
        const runtime = createConnectionsRuntime({
          db,
          env: { EVERHOUR_API_KEY_ENCRYPTION_KEY: EVERHOUR_ENV_KEY },
          publicBaseUrl: 'https://backend.test',
          webReturnOrigin: null
        });
        const app = express();
        app.use(express.json());
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
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/connections`;
        const bodies: string[] = [];
        const call = async (method: string, path: string, body?: unknown) => {
          const response = await fetch(`${base}${path}`, {
            method,
            headers: body ? { 'content-type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined
          });
          const text = await response.text();
          bodies.push(text);
          return { status: response.status, json: JSON.parse(text) };
        };
        try {
          // The default listing stays Cloud-only and unchanged for older clients.
          assert.equal((await call('GET', '')).json.code, 'chat_unavailable');
          const empty = await call('GET', '?scope=all');
          assert.deepEqual(empty.json.items, []);
          assert.deepEqual(
            empty.json.providers.map((p: { provider: string; available: boolean }) => [
              p.provider,
              p.available
            ]),
            [
              ['knowledgebase', false],
              ['everhour', true]
            ]
          );
          assert.equal(empty.json.providers[0].reason, 'not_offered_on_edition');
          const secret = `route-secret-${randomUUID()}`;
          const stored = await call('POST', '/api-keys', { provider: 'everhour', apiKey: secret });
          assert.equal(stored.status, 200);
          assert.equal(stored.json.state, 'connected');
          assert.equal(stored.json.scope, 'profile');
          assert.equal(stored.json.organizationId, null);
          assert.equal(stored.json.credentialKind, 'api_key');
          assert.deepEqual(stored.json.account, {
            id: '7',
            label: 'Everhour Operator',
            avatarUrl: null
          });
          assert.equal(
            (await call('POST', '/api-keys', { provider: 'everhour', apiKey: 'rejected-key' }))
              .status,
            422
          );
          assert.equal(
            (await call('POST', '/api-keys', { provider: 'everhour', apiKey: 'unreachable-key' }))
              .status,
            502
          );
          assert.equal(
            (await call('POST', '/api-keys', { provider: 'everhour', apiKey: '  ' })).status,
            400
          );
          assert.equal(
            (await call('POST', '/api-keys', { provider: 'knowledgebase', apiKey: 'x' })).status,
            404
          );
          const listed = await call('GET', '?scope=all');
          assert.deepEqual(
            listed.json.items.map((i: { id: string }) => i.id),
            [stored.json.id]
          );
          const removed = await call('DELETE', `/${stored.json.id}`);
          assert.equal(removed.json.state, 'disconnected');
          assert.equal((await call('DELETE', `/${stored.json.id}`)).status, 404);
          // Another profile's connection is invisible.
          assert.equal((await call('DELETE', '/legacy-owner')).status, 404);

          const exposures = [
            ...bodies,
            ...logged,
            JSON.stringify(await db.all('SELECT * FROM entity_changes')),
            JSON.stringify(await db.all('SELECT * FROM outbox_messages')),
            JSON.stringify(await db.all('SELECT * FROM account_connections'))
          ].join('\n');
          for (const plaintext of [secret, API_KEY]) assert.ok(!exposures.includes(plaintext));
        } finally {
          server.close();
        }
      } finally {
        Object.assign(console, originals);
        await cleanup();
      }
    });

    it('without any key the provider is unavailable and connecting answers 503', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'profile_connections');
      try {
        await migratedWithLegacy(db);
        const store = profiles(db, {});
        assert.deepEqual(
          store.providers().find(p => p.provider === 'everhour'),
          {
            provider: 'everhour',
            scope: 'profile',
            credentialKind: 'api_key',
            available: false,
            reason: 'encryption_not_configured'
          }
        );
        await assert.rejects(
          store.setApiKey('other', { provider: 'everhour', apiKey: 'k' }),
          (error: unknown) => (error as { code?: string }).code === 'provider_not_ready'
        );
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
