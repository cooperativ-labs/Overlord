import {
  createPostgresClient,
  createSqliteClient,
  type DatabaseClient,
  migratePostgres,
  openInMemoryDatabase
} from '@overlord/database';
import express from 'express';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { type ChatOwner, Conversations } from '../../packages/core/service/chat/conversations.ts';
import { ChatRuns } from '../../packages/core/service/chat/runs.ts';

import { ConnectionsConfigError, connectionsConfigFromEnv } from './config.ts';
import { openSecret, sealSecret } from './crypto.ts';
import { EgressError, egressFetch } from './egress.ts';
import { FakeKnowledgebase, KB_MCP_URL, KB_ORIGIN } from './fake-knowledgebase.ts';
import { createConnectionsRuntime } from './index.ts';
import { namespacedToolId } from './policy.ts';
import { createConnectionsPublicRouter, createConnectionsRouter } from './routes.ts';
import { ConnectionAccessError } from './service.ts';

const owner: ChatOwner = { profileId: 'owner', organizationId: 'org' };
const other: ChatOwner = { profileId: 'other', organizationId: 'org' };
const ownerElsewhere: ChatOwner = { profileId: 'owner', organizationId: 'org2' };
const adapters = ['sqlite', ...(process.env.TEST_DATABASE_URL ? ['postgres'] : [])];
const KEY = randomBytes(32).toString('base64url');
const identity = { provider: 'fake', model: 'fake-1', configDigest: 'c', checkpointVersion: 1 };

async function database(
  adapter: string
): Promise<{ db: DatabaseClient; cleanup: () => Promise<void> }> {
  if (adapter === 'sqlite') {
    const raw = openInMemoryDatabase();
    return {
      db: createSqliteClient(raw),
      cleanup: async () => {
        raw.close();
      }
    };
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const session = await pool.connect(),
    schema = `connections_${randomUUID().replaceAll('-', '')}`;
  await session.query(`CREATE SCHEMA ${schema}`);
  const scoped = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 6
  });
  const db = createPostgresClient(scoped, { ownsPool: true });
  await migratePostgres(db);
  return {
    db,
    cleanup: async () => {
      await db.close();
      await session.query(`DROP SCHEMA ${schema} CASCADE`);
      session.release();
      await pool.end();
    }
  };
}

async function seed(db: DatabaseClient) {
  const stamp = '2026-10-04T12:00:00.000Z';
  const bool = db.dialect === 'sqlite' ? '0' : 'FALSE';
  for (const id of ['owner', 'other'])
    await db.run(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, ${bool}, ?, ?)`,
      [id, id, `${id}@test.invalid`, stamp, stamp]
    );
  for (const org of ['org', 'org2']) {
    await db.run(
      'INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [org, org, stamp, stamp]
    );
    await db.run(
      "INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, 'hosted', ?, ?)",
      [`ws-${org}`, org, `ws-${org}`, org, stamp, stamp]
    );
  }
  for (const [id, profile, org] of [
    ['m1', 'owner', 'org'],
    ['m2', 'other', 'org'],
    ['m3', 'owner', 'org2']
  ])
    await db.run(
      "INSERT INTO workspace_users (id, workspace_id, profile_id, member_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      [id, `ws-${org}`, profile, `${profile}-${org}`, stamp, stamp]
    );
}

function runtime(
  db: DatabaseClient,
  kb: FakeKnowledgebase,
  extra: { sourceCheckTtlMs?: number } = {}
) {
  return createConnectionsRuntime({
    db,
    env: { KNOWLEDGEBASE_MCP_URL: KB_MCP_URL, ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: KEY },
    publicBaseUrl: 'https://backend.test',
    webReturnOrigin: 'https://app.test',
    fetch: kb.fetch,
    now: () => kb.now,
    ...extra
  });
}

async function fixture(
  adapter: string,
  fn: (ctx: {
    db: DatabaseClient;
    kb: FakeKnowledgebase;
    rt: ReturnType<typeof runtime>;
  }) => Promise<void>
) {
  const { db, cleanup } = await database(adapter);
  try {
    await seed(db);
    const kb = new FakeKnowledgebase();
    await fn({ db, kb, rt: runtime(db, kb) });
  } finally {
    await cleanup();
  }
}

async function connect(
  rt: ReturnType<typeof runtime>,
  kb: FakeKnowledgebase,
  who = owner,
  user = 'kb-owner'
) {
  const started = await rt.connections.start(who, {
    provider: 'knowledgebase',
    returnTo: 'mobile'
  });
  const outcome = await rt.connections.complete(kb.consent(started.authorizeUrl, user));
  assert.deepEqual(outcome, { status: 'connected', returnTo: 'mobile' });
  return started.connectionId;
}

const rejectsCode = (code: string) => (e: unknown) =>
  Boolean(e && typeof e === 'object' && 'code' in e && (e as { code: unknown }).code === code);

for (const adapter of adapters)
  describe(`account connections and Knowledgebase reads [${adapter}]`, () => {
    it('signs in with PKCE + resource through the CIMD client and stores only sealed or hashed secrets', () =>
      fixture(adapter, async ({ db, kb, rt }) => {
        const started = await rt.connections.start(owner, {
          provider: 'knowledgebase',
          returnTo: 'web'
        });
        const url = new URL(started.authorizeUrl);
        assert.equal(
          url.searchParams.get('client_id'),
          'https://backend.test/oauth/clients/knowledgebase.json'
        );
        assert.equal(
          url.searchParams.get('redirect_uri'),
          'https://backend.test/api/connections/knowledgebase/callback'
        );
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(url.searchParams.get('resource'), KB_MCP_URL);
        assert.equal(url.searchParams.get('code_verifier'), null);
        const state = url.searchParams.get('state')!;
        const pending = JSON.stringify(
          await db.all('SELECT * FROM account_connection_authorizations')
        );
        assert.ok(!pending.includes(state), 'state is stored only as a hash');
        assert.equal((await rt.connections.list(owner)).items[0]!.state, 'pending');

        const callback = kb.consent(started.authorizeUrl, 'kb-owner');
        assert.deepEqual(await rt.connections.complete(callback), {
          status: 'connected',
          returnTo: 'web'
        });
        // Single use: a replayed callback cannot reconnect or overwrite.
        assert.equal((await rt.connections.complete(callback)).status, 'expired');
        assert.equal(
          (await rt.connections.complete({ state: 'x'.repeat(43), code: 'c' })).status,
          'expired'
        );

        const [dto] = (await rt.connections.list(owner)).items;
        assert.equal(dto!.state, 'connected');
        assert.deepEqual(dto!.authorizedWorkspaces, ['main', 'overlord']);
        assert.equal(dto!.toolPolicyVersion, 1);
        const everything =
          JSON.stringify(await db.all('SELECT * FROM account_connections')) + JSON.stringify(dto);
        assert.ok(!kb.leaks(everything), 'no raw token or code in rows or DTOs');
        assert.ok(!('credential' in dto!) && !JSON.stringify(dto).includes('v1.'));
        assert.deepEqual(rt.clientMetadata(), {
          client_id: 'https://backend.test/oauth/clients/knowledgebase.json',
          client_name: 'Overlord',
          client_uri: 'https://backend.test',
          redirect_uris: ['https://backend.test/api/connections/knowledgebase/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'openid offline_access'
        });
        assert.ok(JSON.stringify(rt.clientMetadata()).length <= 5 * 1024);
      }));

    it('expired, denied, and tampered callbacks fail without connecting', () =>
      fixture(adapter, async ({ kb, rt }) => {
        const a = await rt.connections.start(owner, {
          provider: 'knowledgebase',
          returnTo: 'mobile'
        });
        const denied = new URL(a.authorizeUrl).searchParams.get('state')!;
        assert.deepEqual(await rt.connections.complete({ state: denied, error: 'access_denied' }), {
          status: 'denied',
          returnTo: 'mobile'
        });
        const b = await rt.connections.start(owner, {
          provider: 'knowledgebase',
          returnTo: 'mobile'
        });
        const consent = kb.consent(b.authorizeUrl, 'kb-owner');
        assert.equal(
          (await rt.connections.complete({ ...consent, code: 'forged' })).status,
          'failed'
        );
        const c = await rt.connections.start(owner, {
          provider: 'knowledgebase',
          returnTo: 'mobile'
        });
        const late = kb.consent(c.authorizeUrl, 'kb-owner');
        kb.now += 11 * 60 * 1000;
        assert.equal((await rt.connections.complete(late)).status, 'expired');
        assert.equal((await rt.connections.list(owner)).items[0]!.state, 'pending');
        await assert.rejects(
          rt.connections.start(owner, { provider: 'other', returnTo: 'mobile' }),
          rejectsCode('invalid_request')
        );
        await assert.rejects(
          rt.connections.start(owner, { provider: 'knowledgebase', returnTo: 'https://evil.test' }),
          rejectsCode('invalid_request')
        );
      }));

    it('exposes only reviewed read tools, rejects writes regardless of annotations, and bounds arguments and output', () =>
      fixture(adapter, async ({ db, kb, rt }) => {
        const id = await connect(rt, kb);
        const mcp = rt.knowledgebase!;
        const tools = await mcp.tools(owner);
        assert.deepEqual(tools.map(t => t.tool).sort(), [
          'get_links',
          'get_related',
          'list_children',
          'list_entities',
          'list_workspaces',
          'read_file',
          'read_resource',
          'search'
        ]);
        assert.ok(tools.every(t => t.id === namespacedToolId(id, t.tool) && t.id.length <= 64));
        // Provider-safe: a dotted id was rewritten by Gemini and then rejected as unknown.
        assert.ok(tools.every(t => /^kb_[0-9a-f]{12}_[a-z_]+$/.test(t.id)));
        assert.ok(
          !JSON.stringify(tools).includes('SERVER TEXT'),
          'server descriptions are never exposed'
        );

        const search = await mcp.call(owner, namespacedToolId(id, 'search'), {
          workspace: 'overlord',
          q: 'offline'
        });
        assert.equal(search.outcome, 'ok');
        assert.deepEqual(search.sources, [
          {
            locator: {
              kind: 'knowledgebase',
              connectionId: id,
              workspace: 'overlord',
              nodeId: kb.nodeId,
              path: 'projects/offline.md'
            },
            revision: 'ver-7',
            updatedAt: '2026-10-01T00:00:00.000Z'
          }
        ]);

        const before = kb.calls.length;
        for (const tool of ['delete_file', 'edit_file', 'query', 'list_trash']) {
          const result = await mcp.call(owner, namespacedToolId(id, tool), { path: 'x' });
          assert.equal(result.outcome, 'denied');
          assert.equal(result.detail, 'not_in_read_allowlist');
        }
        assert.equal(kb.calls.length, before, 'rejected tools never reach the server');

        assert.equal(
          (await mcp.call(owner, namespacedToolId(id, 'search'), { workspace: 'overlord' }))
            .outcome,
          'invalid_arguments'
        );
        assert.equal(
          (
            await mcp.call(owner, namespacedToolId(id, 'search'), {
              workspace: 'overlord',
              q: 'a',
              extra: 1
            })
          ).outcome,
          'invalid_arguments'
        );
        assert.equal(
          (
            await mcp.call(owner, namespacedToolId(id, 'search'), {
              workspace: 'overlord',
              q: 'a'.repeat(5000)
            })
          ).outcome,
          'invalid_arguments'
        );
        const foreign = await mcp.call(owner, namespacedToolId(id, 'search'), {
          workspace: 'secret',
          q: 'a'
        });
        assert.equal(foreign.detail, 'workspace_not_authorized');

        kb.readFileBytes = 200 * 1024;
        const big = await mcp.call(owner, namespacedToolId(id, 'read_file'), {
          workspace: 'main',
          path: 'big.md'
        });
        assert.equal(big.outcome, 'ok');
        assert.equal(big.truncated, true);
        assert.ok(big.bytes <= 64 * 1024);
        assert.equal(big.sources[0]!.revision, 'ver-7', 'provenance comes from the full response');
        kb.readFileBytes = 2 * 1024 * 1024;
        const huge = await mcp.call(owner, namespacedToolId(id, 'read_file'), {
          workspace: 'main',
          path: 'huge.md'
        });
        assert.equal(huge.outcome, 'tool_error');
        assert.equal(huge.detail, 'response_too_large');

        // A reviewed tool the server stops annotating read-only is withheld (annotations only narrow).
        kb.readOnly.delete('get_links');
        const fresh = runtime(db, kb);
        assert.ok(!(await fresh.knowledgebase!.tools(owner)).some(t => t.tool === 'get_links'));
        assert.equal(
          (
            await fresh.knowledgebase!.call(owner, namespacedToolId(id, 'get_links'), {
              workspace: 'main',
              path: 'a'
            })
          ).detail,
          'withheld_by_server_annotations'
        );
      }));

    it('denies every cross-owner and cross-organization use, including a copied envelope', () =>
      fixture(adapter, async ({ db, kb, rt }) => {
        const id = await connect(rt, kb);
        for (const who of [other, ownerElsewhere]) {
          assert.deepEqual((await rt.connections.list(who)).items, []);
          await assert.rejects(rt.connections.disconnect(who, id), rejectsCode('not_found'));
          await assert.rejects(
            rt.connections.accessToken(who, id),
            (e: unknown) => e instanceof ConnectionAccessError && e.code === 'not_found'
          );
          assert.deepEqual(await rt.knowledgebase!.tools(who), []);
          const call = await rt.knowledgebase!.call(who, namespacedToolId(id, 'search'), {
            workspace: 'main',
            q: 'a'
          });
          assert.equal(call.outcome, 'denied');
          assert.equal(call.detail, 'unknown_tool');
          const locator = {
            kind: 'knowledgebase' as const,
            connectionId: id,
            workspace: 'main',
            nodeId: kb.nodeId,
            path: null
          };
          assert.equal(await rt.checkSource(who, locator, AbortSignal.timeout(1000)), 'revoked');
        }
        await assert.rejects(
          rt.connections.list({ profileId: 'other', organizationId: 'org2' }),
          rejectsCode('not_found')
        );

        // The envelope is bound to owner, organization, provider and connection id.
        const otherId = await connect(rt, kb, other, 'kb-other');
        const stolen = await db.get<{ credential_ciphertext: string }>(
          'SELECT credential_ciphertext FROM account_connections WHERE id = ?',
          [id]
        );
        await db.run('UPDATE account_connections SET credential_ciphertext = ? WHERE id = ?', [
          stolen!.credential_ciphertext,
          otherId
        ]);
        await assert.rejects(
          rt.connections.accessToken(other, otherId),
          (e: unknown) =>
            e instanceof ConnectionAccessError && e.code === 'reauthorization_required'
        );
        assert.equal(
          (await rt.connections.list(other)).items[0]!.state,
          'reauthorization_required'
        );
        assert.equal((await rt.connections.list(owner)).items[0]!.state, 'connected');
      }));

    it('serializes concurrent refresh across processes, persists the rotation, and never replays a rotated token', () =>
      fixture(adapter, async ({ db, kb, rt }) => {
        const id = await connect(rt, kb);
        const second = runtime(db, kb); // another backend process sharing the database
        kb.now += 3601 * 1000;
        kb.refreshDelayMs = 50;
        const before = (await db.get<{ credential_revision: number }>(
          'SELECT credential_revision FROM account_connections WHERE id = ?',
          [id]
        ))!.credential_revision;
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            (i % 2 ? second : rt).knowledgebase!.call(owner, namespacedToolId(id, 'search'), {
              workspace: 'main',
              q: 'x'
            })
          )
        );
        assert.ok(
          results.every(r => r.outcome === 'ok'),
          JSON.stringify(results.map(r => r.detail))
        );
        assert.equal(
          kb.tokenRequests.filter(g => g === 'refresh_token').length,
          1,
          'exactly one refresh'
        );
        const row = (await db.get<{
          credential_revision: number;
          refresh_lock_owner: string | null;
          last_refreshed_at: string;
        }>(
          'SELECT credential_revision, refresh_lock_owner, last_refreshed_at FROM account_connections WHERE id = ?',
          [id]
        ))!;
        assert.equal(row.credential_revision, before + 1);
        assert.equal(row.refresh_lock_owner, null);
        // Long after the grace window, the next refresh still uses the persisted rotated token.
        kb.now += 3601 * 1000;
        assert.equal(
          (
            await rt.knowledgebase!.call(owner, namespacedToolId(id, 'search'), {
              workspace: 'main',
              q: 'x'
            })
          ).outcome,
          'ok'
        );
        assert.equal(kb.tokenRequests.filter(g => g === 'refresh_token').length, 2);
        assert.equal((await rt.connections.list(owner)).items[0]!.state, 'connected');
      }));

    it('revocation fails closed: consent revoked upstream requires reauthorization and node revocation is observed', () =>
      fixture(adapter, async ({ db, kb }) => {
        const rt = runtime(db, kb, { sourceCheckTtlMs: 0 });
        const id = await connect(rt, kb);
        const locator = {
          kind: 'knowledgebase' as const,
          connectionId: id,
          workspace: 'main',
          nodeId: kb.nodeId,
          path: null
        };
        const signal = () => AbortSignal.timeout(2000);
        assert.equal(await rt.checkSource(owner, locator, signal()), 'authorized');
        kb.revokedNodes.add(`kb-owner:${kb.nodeId}`);
        assert.equal(await rt.checkSource(owner, locator, signal()), 'revoked');
        kb.revokedNodes.clear();
        assert.equal(await rt.checkSource(owner, locator, signal()), 'authorized');

        kb.revokeConsent('kb-owner');
        const result = await rt.knowledgebase!.call(owner, namespacedToolId(id, 'search'), {
          workspace: 'main',
          q: 'x'
        });
        assert.equal(result.outcome, 'reauthorization_required');
        const [dto] = (await rt.connections.list(owner)).items;
        assert.equal(dto!.state, 'reauthorization_required');
        assert.equal(dto!.lastErrorCode, 'invalid_grant');
        const row = await db.get<{ credential_ciphertext: string | null }>(
          'SELECT credential_ciphertext FROM account_connections WHERE id = ?',
          [id]
        );
        assert.equal(row!.credential_ciphertext, null, 'unusable credentials are erased');
        assert.equal(await rt.checkSource(owner, locator, signal()), 'unknown');
        assert.deepEqual(await rt.knowledgebase!.tools(owner), []);

        // Reauthorization reuses the same connection and restores reads.
        assert.equal(await connect(rt, kb), id);
        assert.equal(
          (
            await rt.knowledgebase!.call(owner, namespacedToolId(id, 'search'), {
              workspace: 'main',
              q: 'x'
            })
          ).outcome,
          'ok'
        );
      }));

    it('cached positive checks expire, and the connection state is consulted on every check', () =>
      fixture(adapter, async ({ db, kb }) => {
        const rt = runtime(db, kb, { sourceCheckTtlMs: 15_000 });
        const id = await connect(rt, kb);
        const locator = {
          kind: 'knowledgebase' as const,
          connectionId: id,
          workspace: 'main',
          nodeId: kb.nodeId,
          path: null
        };
        assert.equal(await rt.checkSource(owner, locator, AbortSignal.timeout(2000)), 'authorized');
        const calls = kb.calls.length;
        kb.revokedNodes.add(`kb-owner:${kb.nodeId}`);
        assert.equal(await rt.checkSource(owner, locator, AbortSignal.timeout(2000)), 'authorized');
        assert.equal(kb.calls.length, calls, 'served from the short cache');
        kb.now += 15_001;
        assert.equal(await rt.checkSource(owner, locator, AbortSignal.timeout(2000)), 'revoked');
        await rt.connections.disconnect(owner, id);
        assert.equal(await rt.checkSource(owner, locator, AbortSignal.timeout(2000)), 'revoked');
        assert.equal(
          await rt.checkSource(
            owner,
            { kind: 'overlord', entityType: 'project', entityId: 'p', projectId: 'p' },
            AbortSignal.timeout(100)
          ),
          'unknown'
        );
      }));

    it('disconnect erases the envelope, revokes upstream, and invalidates chat content that cited the connection', () =>
      fixture(adapter, async ({ db, kb, rt }) => {
        const id = await connect(rt, kb);
        const options = { checkSource: rt.checkSource, now: () => kb.now };
        const c = new Conversations(db, options),
          runs = new ChatRuns(db, options);
        const created = await c.create(owner, {
          clientRequestId: randomUUID(),
          text: 'What do my notes say?'
        });
        const attempt = await runs.claim('worker-1', identity);
        assert.ok(attempt);
        const locator = {
          kind: 'knowledgebase' as const,
          connectionId: id,
          workspace: 'main',
          nodeId: kb.nodeId,
          path: 'projects/offline.md'
        };
        const deps = await c.sources(owner, attempt.threadId, [
          { scopeKey: `kb:${id}:main:${kb.nodeId}`, locator }
        ]);
        const linked = await db.get<{ connection_id: string | null }>(
          'SELECT connection_id FROM chat_source_refs WHERE thread_id = ?',
          [attempt.threadId]
        );
        assert.equal(linked!.connection_id, id);
        const messageId = await runs.text(attempt, 'kb-derived-answer', deps);

        const dto = await rt.connections.disconnect(owner, id);
        assert.equal(dto.state, 'disconnected');
        assert.deepEqual(kb.revocations.sort(), ['access_token', 'refresh_token']);
        const row = await db.get<{
          credential_ciphertext: string | null;
          credential_key_id: string | null;
        }>(
          'SELECT credential_ciphertext, credential_key_id FROM account_connections WHERE id = ?',
          [id]
        );
        assert.deepEqual({ ...row }, { credential_ciphertext: null, credential_key_id: null });
        assert.deepEqual((await rt.connections.list(owner)).items, []);
        await assert.rejects(rt.connections.disconnect(owner, id), rejectsCode('not_found'));

        // Invalidated proactively, before any client reads the thread again.
        const source = await db.get<{ access_state: string }>(
          'SELECT access_state FROM chat_source_refs WHERE thread_id = ?',
          [attempt.threadId]
        );
        assert.equal(source!.access_state, 'revoked');
        const snapshot = await c.snapshot(owner, created.thread.id);
        assert.equal(
          snapshot.messages.find(m => m.id === messageId)!.blocks[0]!.kind,
          'unavailable'
        );
        assert.equal(snapshot.latestRun!.failureCode, 'source_access_lost');
        assert.ok(
          !JSON.stringify(await c.events(owner, created.thread.id, 0)).includes('kb-derived-answer')
        );

        // A new sign-in creates a fresh connection; old content stays invalidated.
        const again = await connect(rt, kb);
        assert.notEqual(again, id);
      }));
  });

describe('connections module boundaries', () => {
  it('shared envelopes bind their AAD, and keep the existing v1 format', () => {
    const key = randomBytes(32);
    const envelope = sealSecret({ plaintext: 'secret', key, aad: 'a' });
    assert.match(envelope, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.equal(openSecret({ envelope, key, aad: 'a' }), 'secret');
    assert.throws(() => openSecret({ envelope, key, aad: 'b' }));
    assert.throws(() => openSecret({ envelope, key: randomBytes(32), aad: 'a' }));
  });

  it('egress allows only approved HTTPS origins and never follows redirects', async () => {
    const fetchImpl = async (url: string) =>
      url.endsWith('/redirect')
        ? new Response(null, { status: 302, headers: { location: 'https://evil.test' } })
        : new Response('x'.repeat(100));
    for (const url of [
      'http://kb.test/mcp',
      'https://evil.test/mcp',
      'https://user:pw@kb.test/mcp'
    ])
      await assert.rejects(
        egressFetch(fetchImpl, [KB_ORIGIN], url, {}, { timeoutMs: 100, maxBytes: 10 }),
        (e: unknown) => e instanceof EgressError && e.code === 'egress_denied'
      );
    await assert.rejects(
      egressFetch(
        fetchImpl,
        [KB_ORIGIN],
        `${KB_ORIGIN}/redirect`,
        {},
        { timeoutMs: 100, maxBytes: 10 }
      ),
      (e: unknown) => e instanceof EgressError && e.code === 'redirect'
    );
    const bounded = await egressFetch(
      fetchImpl,
      [KB_ORIGIN],
      `${KB_ORIGIN}/x`,
      {},
      { timeoutMs: 100, maxBytes: 10 }
    );
    assert.deepEqual([bounded.bytes, bounded.truncated], [10, true]);
    const slow = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
      );
    await assert.rejects(
      egressFetch(slow, [KB_ORIGIN], `${KB_ORIGIN}/x`, {}, { timeoutMs: 20, maxBytes: 10 }),
      (e: unknown) => e instanceof EgressError && e.code === 'timeout'
    );
    assert.throws(
      () =>
        connectionsConfigFromEnv(
          { KNOWLEDGEBASE_MCP_URL: 'http://kb.test/mcp' },
          'https://b',
          null
        ),
      ConnectionsConfigError
    );
    const config = connectionsConfigFromEnv(
      { KNOWLEDGEBASE_MCP_URL: KB_MCP_URL, KNOWLEDGEBASE_EGRESS_ORIGINS: 'https://auth.kb.test' },
      'https://b/',
      null
    );
    assert.deepEqual(config.knowledgebase!.egressOrigins, [KB_ORIGIN, 'https://auth.kb.test']);
    assert.equal(config.encryption, null);
  });

  it('an authorization server on an unapproved origin is refused before any sign-in', async () => {
    const { db, cleanup } = await database('sqlite');
    try {
      await seed(db);
      const kb = new FakeKnowledgebase();
      const hostile = async (url: string, init: RequestInit = {}) => {
        const response = await kb.fetch(url, init);
        if (!url.includes('oauth-authorization-server')) return response;
        const body = (await response.json()) as Record<string, string>;
        return new Response(
          JSON.stringify({ ...body, token_endpoint: 'https://evil.test/token' }),
          { status: 200 }
        );
      };
      const rt = createConnectionsRuntime({
        db,
        env: { KNOWLEDGEBASE_MCP_URL: KB_MCP_URL, ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: KEY },
        publicBaseUrl: 'https://backend.test',
        webReturnOrigin: null,
        fetch: hostile
      });
      await assert.rejects(
        rt.connections.start(owner, { provider: 'knowledgebase', returnTo: 'mobile' }),
        rejectsCode('provider_not_ready')
      );
      const unconfigured = createConnectionsRuntime({
        db,
        env: {},
        publicBaseUrl: 'https://backend.test',
        webReturnOrigin: null,
        fetch: kb.fetch
      });
      await assert.rejects(
        unconfigured.connections.start(owner, { provider: 'knowledgebase', returnTo: 'mobile' }),
        rejectsCode('provider_not_ready')
      );
      assert.equal(unconfigured.clientMetadata(), null);
    } finally {
      await cleanup();
    }
  });

  it('HTTP: metadata document, status-only callback redirects, owner-scoped routes, and the Local guard', async () => {
    const { db, cleanup } = await database('sqlite');
    const kb = new FakeKnowledgebase();
    const context = new AsyncLocalStorage<ChatOwner>();
    let cloud = true;
    const rt = runtime(db, kb);
    const app = express();
    app.use(express.json());
    app.use(createConnectionsPublicRouter({ cloud: () => cloud, runtime: () => rt }));
    app.use((req, res, next) => {
      if (!req.headers.authorization) {
        res.sendStatus(401);
        return;
      }
      context.run(req.headers.authorization === 'Bearer owner' ? owner : other, next);
    });
    app.use(
      '/api/connections',
      createConnectionsRouter({
        cloud: () => cloud,
        runtime: () => rt,
        owner: () => context.getStore() ?? null
      })
    );
    const server = app.listen(0);
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const as = (who: string) => ({
      authorization: `Bearer ${who}`,
      'content-type': 'application/json'
    });
    try {
      await seed(db);
      const metadata = await fetch(`${base}/oauth/clients/knowledgebase.json`);
      assert.equal(metadata.status, 200);
      assert.equal(
        ((await metadata.json()) as { client_id: string }).client_id,
        'https://backend.test/oauth/clients/knowledgebase.json'
      );

      const start = await fetch(`${base}/api/connections`, {
        method: 'POST',
        headers: as('owner'),
        body: JSON.stringify({ provider: 'knowledgebase', returnTo: 'mobile' })
      });
      const started = (await start.json()) as { connectionId: string; authorizeUrl: string };
      assert.equal(start.status, 200);
      const consent = kb.consent(started.authorizeUrl, 'kb-owner');
      const callback = `${base}/api/connections/knowledgebase/callback?${new URLSearchParams(consent)}`;
      const done = await fetch(callback, { redirect: 'manual' });
      assert.equal(done.status, 302);
      assert.equal(
        done.headers.get('location'),
        'overlord://connections/callback?provider=knowledgebase&status=connected'
      );
      assert.equal(done.headers.get('cache-control'), 'no-store');
      const replay = await fetch(callback, { redirect: 'manual' });
      assert.equal(
        replay.headers.get('location'),
        'overlord://connections/callback?provider=knowledgebase&status=expired'
      );
      const unknown = await fetch(`${base}/api/connections/knowledgebase/callback?state=bogus`, {
        redirect: 'manual'
      });
      assert.equal(unknown.status, 400);
      assert.match(await unknown.text(), /expired/);

      const list = await fetch(`${base}/api/connections`, { headers: as('owner') });
      const body = await list.text();
      assert.equal(JSON.parse(body).items[0].state, 'connected');
      assert.ok(!kb.leaks(body));
      assert.deepEqual(
        JSON.parse(await (await fetch(`${base}/api/connections`, { headers: as('other') })).text()),
        { items: [] }
      );
      const foreign = await fetch(`${base}/api/connections/${started.connectionId}`, {
        method: 'DELETE',
        headers: as('other')
      });
      assert.deepEqual(
        [foreign.status, ((await foreign.json()) as { code: string }).code],
        [404, 'not_found']
      );
      const bad = await fetch(`${base}/api/connections`, {
        method: 'POST',
        headers: as('owner'),
        body: JSON.stringify({ provider: 'knowledgebase', returnTo: 'elsewhere' })
      });
      assert.equal(bad.status, 400);
      const removed = await fetch(`${base}/api/connections/${started.connectionId}`, {
        method: 'DELETE',
        headers: as('owner')
      });
      assert.equal(((await removed.json()) as { state: string }).state, 'disconnected');

      cloud = false;
      const local = await fetch(`${base}/api/connections`, { headers: as('owner') });
      assert.deepEqual(
        [local.status, ((await local.json()) as { code: string }).code],
        [404, 'chat_unavailable']
      );
      assert.equal((await fetch(`${base}/oauth/clients/knowledgebase.json`)).status, 404);
    } finally {
      server.close();
      await cleanup();
    }
  });
});
