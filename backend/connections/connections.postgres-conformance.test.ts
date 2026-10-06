import { type DatabaseClient } from '@overlord/database';
import express from 'express';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { type ChatOwner, Conversations } from '../../packages/core/service/chat/conversations.ts';
import { ChatRuns } from '../../packages/core/service/chat/runs.ts';
import { apiErrorHandler } from '../errors.ts';
import {
  type ConformanceAdapter,
  conformanceAdapters,
  createConformanceDatabase
} from '../test-helpers.ts';

import {
  ConnectionsConfigError,
  connectionsConfigFromEnv,
  DEFAULT_KNOWLEDGEBASE_MCP_URL
} from './config.ts';
import { openSecret, sealSecret } from './crypto.ts';
import { EgressError, egressFetch } from './egress.ts';
import { createConnectionsRuntime } from './index.ts';
import { isPlatformKeyId, platformKeyFromSecret } from './keyring.ts';
import { FakeKnowledgebase, KB_MCP_URL, KB_ORIGIN } from './knowledgebase-test-fixture.ts';
import { KnowledgebaseMcp } from './mcp-client.ts';
import { namespacedToolId } from './policy.ts';
import { createConnectionsPublicRouter, createConnectionsRouter } from './routes.ts';
import { ConnectionAccessError } from './service.ts';

const owner: ChatOwner = { profileId: 'owner', organizationId: 'org' };
const other: ChatOwner = { profileId: 'other', organizationId: 'org' };
const ownerElsewhere: ChatOwner = { profileId: 'owner', organizationId: 'org2' };
const adapters = conformanceAdapters();
const KEY = randomBytes(32).toString('base64url');
const identity = { provider: 'fake', model: 'fake-1', configDigest: 'c', checkpointVersion: 1 };

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
  adapter: ConformanceAdapter,
  fn: (ctx: {
    db: DatabaseClient;
    kb: FakeKnowledgebase;
    rt: ReturnType<typeof runtime>;
  }) => Promise<void>
) {
  const { db, cleanup } = await createConformanceDatabase(adapter, 'connections');
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
        assert.equal(dto!.toolPolicyVersion, 2);
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

    it('exposes only reviewed read tools without a grant, rejects writes and unreviewed tools, and bounds arguments and output', () =>
      fixture(adapter, async ({ db, kb, rt }) => {
        const id = await connect(rt, kb);
        const mcp = rt.knowledgebase!;
        const tools = await mcp.tools(owner);
        assert.deepEqual(tools.map(t => t.tool).sort(), [
          'get_links',
          'get_registries',
          'get_related',
          'list_children',
          'list_entities',
          'list_workspaces',
          'query',
          'read_file',
          'read_resource',
          'search'
        ]);
        assert.ok(tools.every(t => t.access === 'read'));
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
        for (const tool of ['delete_file', 'grant_access', 'list_trash']) {
          const result = await mcp.call(owner, namespacedToolId(id, tool), { path: 'x' });
          assert.equal(result.outcome, 'denied');
          assert.equal(result.detail, 'not_in_allowlist');
        }
        // A reviewed write without the run's grant is refused before any request.
        const ungranted = await mcp.call(owner, namespacedToolId(id, 'edit_file'), {
          workspace: 'main',
          path: 'x.md',
          old_text: '',
          new_text: 'y',
          expected_version: 'ver-1'
        });
        assert.deepEqual([ungranted.outcome, ungranted.detail], ['denied', 'write_not_authorized']);
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

    it('offers reviewed writes only for the granted connection, and server annotations can only withhold them', () =>
      fixture(adapter, async ({ db, kb, rt }) => {
        const id = await connect(rt, kb);
        const mcp = rt.knowledgebase!;
        const grant = { connectionId: id, workspace: 'main' };
        const writes = (await mcp.tools(owner, undefined, { write: grant }))
          .filter(t => t.access === 'write')
          .map(t => t.tool)
          .sort();
        assert.deepEqual(writes, [
          'add_relation',
          'create_node',
          'edit_file',
          'remove_relation',
          'set_properties',
          'update_relation'
        ]);
        // A grant naming another connection adds nothing; a foreign owner's connection is unknown.
        const elsewhere = { connectionId: randomUUID(), workspace: 'main' };
        assert.ok(
          (await mcp.tools(owner, undefined, { write: elsewhere })).every(t => t.access === 'read')
        );
        assert.equal(await mcp.authorizeWrite(owner, grant), 'authorized');
        assert.equal(await mcp.authorizeWrite(owner, { ...grant, workspace: 'secret' }), 'invalid');
        assert.equal(await mcp.authorizeWrite(other, grant), 'invalid');
        assert.equal(await mcp.authorizeWrite(ownerElsewhere, grant), 'invalid');
        // Annotations only narrow: an unexpectedly destructive create is withheld, while the
        // reviewed-destructive remove_relation stays available.
        kb.readOnly.delete('get_registries');
        const original = kb.fetch;
        kb.fetch = async (input, init) => {
          const response = await original(input, init);
          if (!String(init?.body ?? '').includes('"tools/list"')) return response;
          const body = (await response.json()) as {
            result: { tools: { name: string; annotations: Record<string, unknown> }[] };
          };
          for (const tool of body.result.tools)
            if (tool.name === 'create_node') tool.annotations.destructiveHint = true;
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: response.headers
          });
        };
        const fresh = runtime(db, kb);
        const offered = (await fresh.knowledgebase!.tools(owner, undefined, { write: grant })).map(
          t => t.tool
        );
        assert.ok(!offered.includes('create_node'));
        assert.ok(offered.includes('remove_relation'));
        assert.ok(!offered.includes('get_registries'), 'a read no longer annotated read-only');
        assert.equal(
          (
            await fresh.knowledgebase!.call(
              owner,
              namespacedToolId(id, 'create_node'),
              { workspace: 'main', path: 'n.md', expected_version: 'new' },
              undefined,
              { write: grant }
            )
          ).detail,
          'withheld_by_server_annotations'
        );
        kb.fetch = original;
      }));

    it('writes general notes with revision guards, conflicts, refusals, and uncertain outcomes', () =>
      fixture(adapter, async ({ kb, rt }) => {
        const id = await connect(rt, kb);
        const mcp = rt.knowledgebase!;
        const write = { write: { connectionId: id, workspace: 'main' } };
        const call = (tool: string, args: Record<string, unknown>) =>
          mcp.call(owner, namespacedToolId(id, tool), args, undefined, write);

        const created = await call('create_node', {
          workspace: 'main',
          path: 'notes/standup.md',
          expected_version: 'new',
          content: 'Standup\nproject:: [[Overlord]]\n'
        });
        assert.equal(created.outcome, 'ok');
        assert.equal(created.sources[0]!.locator.path, 'notes/standup.md', 'write provenance');
        const read = JSON.parse(
          (await call('read_file', { workspace: 'main', path: 'notes/standup.md' })).text
        ) as { expectedVersion: string };
        const stale = await call('edit_file', {
          workspace: 'main',
          path: 'notes/standup.md',
          old_text: 'Standup',
          new_text: 'Standup (edited)',
          expected_version: 'ver-0'
        });
        assert.equal(stale.outcome, 'conflict', "edit_file's version check is a conflict");
        const edited = await call('edit_file', {
          workspace: 'main',
          path: 'notes/standup.md',
          old_text: 'Standup',
          new_text: 'Standup (edited)',
          expected_version: read.expectedVersion
        });
        assert.equal(edited.outcome, 'ok');
        assert.ok([...kb.nodes.values()][0]!.content.startsWith('Standup (edited)'));

        // A repeated create is refused by the server, never a second node.
        const again = await call('create_node', {
          workspace: 'main',
          path: 'notes/standup.md',
          expected_version: 'new'
        });
        assert.deepEqual([again.outcome, again.upstreamStatus], ['conflict', 409]);

        // A write whose response is lost after it was applied is uncertain and not retried.
        const before = kb.calls.filter(c => c.tool === 'create_node').length;
        kb.loseResponseAfter = 'create_node';
        const lost = await call('create_node', {
          workspace: 'main',
          path: 'notes/lost.md',
          expected_version: 'new'
        });
        assert.equal(lost.outcome, 'uncertain');
        assert.equal(kb.calls.filter(c => c.tool === 'create_node').length, before + 1);
        assert.ok([...kb.nodes.values()].some(n => n.path === 'notes/lost.md'));

        // The Knowledgebase stays authoritative: a read-only restriction is a 403 tool error.
        kb.readOnlyUsers.add('kb-owner');
        const denied = await call('create_node', {
          workspace: 'main',
          path: 'notes/denied.md',
          expected_version: 'new'
        });
        assert.deepEqual([denied.outcome, denied.upstreamStatus], ['tool_error', 403]);
        kb.readOnlyUsers.clear();

        // The grant's workspace is the only one writable, even if the connection reads others.
        const foreign = await call('create_node', {
          workspace: 'overlord',
          path: 'notes/x.md',
          expected_version: 'new'
        });
        assert.deepEqual([foreign.outcome, foreign.detail], ['denied', 'write_not_authorized']);

        // Bounded arguments: closed top level, required guards, nested depth and size.
        const invalid = async (tool: string, args: Record<string, unknown>) =>
          assert.equal(
            (await call(tool, args)).outcome,
            'invalid_arguments',
            JSON.stringify(args).slice(0, 80)
          );
        await invalid('create_node', {
          workspace: 'main',
          path: 'a.md',
          expected_version: 'new',
          extra: 1
        });
        await invalid('create_node', { workspace: 'main', path: 'a.md', expected_version: 'v2' });
        await invalid('update_relation', {
          workspace: 'main',
          relation_id: randomUUID(),
          attributes: {}
        });
        let deep: unknown = 'x';
        for (let i = 0; i < 12; i++) deep = { deep };
        await invalid('add_relation', {
          workspace: 'main',
          from_node_id: randomUUID(),
          to_node_id: randomUUID(),
          attributes: { deep }
        });
        await invalid('set_properties', {
          workspace: 'main',
          node_id: randomUUID(),
          properties: { score: Number.POSITIVE_INFINITY },
          expected_metadata_revision: 1
        });
        await invalid('create_node', {
          workspace: 'main',
          path: 'big.md',
          expected_version: 'new',
          content: 'x'.repeat(60 * 1024)
        });
      }));

    it('reads and updates Feature metadata: paged queries over 100 candidates, nested citations, null removal, ranking guards', () =>
      fixture(adapter, async ({ kb, rt }) => {
        const id = await connect(rt, kb);
        const mcp = rt.knowledgebase!;
        const write = { write: { connectionId: id, workspace: 'main' } };
        const call = (tool: string, args: Record<string, unknown>) =>
          mcp.call(owner, namespacedToolId(id, tool), args, undefined, write);
        const project = kb.seedNode({ workspace: 'main', path: 'projects/a.md', type: 'project' });
        const features = Array.from({ length: 120 }, (_, i) =>
          kb.seedNode({
            workspace: 'main',
            path: `features/f${String(i).padStart(3, '0')}.md`,
            type: 'feature',
            properties: {
              status: i === 7 ? 'in_development' : 'idea',
              ...(i === 9 ? { overlord: 'coo:9' } : {})
            }
          })
        );
        for (const [i, f] of features.entries())
          kb.seedRelation({
            workspace: 'main',
            from: f.id,
            to: project.id,
            type: 'project',
            attributes: i < 5 ? { rank: 5 - i, keep: 'unrelated' } : {}
          });
        const query = {
          workspace: 'main',
          type: 'feature',
          rel: [{ type: 'project', to_node_id: project.id }],
          where_in: { status: ['idea', 'shaping', 'ready'] },
          where_empty: ['overlord'],
          order_by: { relation: { type: 'project', to_node_id: project.id }, key: 'rank' },
          include: ['properties', 'relations'],
          limit: 100
        };
        const seen: string[] = [];
        let cursor: string | undefined;
        type Page = {
          nodes: {
            id: string;
            metadata_revision: number;
            relations: { id: string; revision: number; attributes: Record<string, unknown> }[];
          }[];
          next_cursor?: string;
        };
        const pages: Page[] = [];
        do {
          const page = await call('query', { ...query, ...(cursor ? { cursor } : {}) });
          assert.equal(page.outcome, 'ok');
          assert.equal(page.truncated, false);
          const body = JSON.parse(page.text) as Page;
          pages.push(body);
          seen.push(...body.nodes.map(n => n.id));
          cursor = body.next_cursor;
        } while (cursor);
        assert.equal(
          seen.length,
          118,
          'every candidate across pages; linked and in-development excluded'
        );
        assert.equal(seen[0], features[4]!.id, 'rank 1 first');

        // Complete metadata is never truncated: a response that does not fit is refused.
        const small = new KnowledgebaseMcp({
          mcpUrl: KB_MCP_URL,
          egressOrigins: [KB_ORIGIN],
          connections: rt.connections,
          fetch: kb.fetch,
          now: () => kb.now,
          bounds: { outputBytes: 2048 }
        });
        const cut = await small.call(owner, namespacedToolId(id, 'query'), query, undefined, write);
        assert.deepEqual(
          [cut.outcome, cut.detail, cut.text],
          ['tool_error', 'response_too_large', '']
        );

        // Ranking write preserves unrelated attributes and uses the relation revision.
        const top = pages[0]!.nodes[0]!;
        const projectRel = top.relations.find(r => r.attributes.rank === 1)!;
        const ranked = await call('update_relation', {
          workspace: 'main',
          relation_id: projectRel.id,
          attributes: { ...projectRel.attributes, rank: 2, rank_rationale: 'Reassessed' },
          expected_revision: projectRel.revision
        });
        assert.equal(ranked.outcome, 'ok');
        const stale = await call('update_relation', {
          workspace: 'main',
          relation_id: projectRel.id,
          attributes: { rank: 9 },
          expected_revision: projectRel.revision
        });
        assert.deepEqual([stale.outcome, stale.upstreamStatus], ['conflict', 412]);
        assert.deepEqual(kb.relations.get(projectRel.id)!.attributes, {
          rank: 2,
          keep: 'unrelated',
          rank_rationale: 'Reassessed'
        });

        // Evidence with a nested citations list, votes as a nested map, then null removal.
        const meeting = kb.seedNode({ workspace: 'main', path: 'meetings/m.md' });
        const evidence = await call('add_relation', {
          workspace: 'main',
          from_node_id: top.id,
          to_node_id: meeting.id,
          relation_type: 'supported_by',
          attributes: {
            citations: [
              { quote: 'Offline matters', locator: { start: 12.5, end: 14 }, resource_id: null },
              { quote: 'Again', locator: { start: 30, end: 31 }, stance: 'for' }
            ]
          }
        });
        assert.equal(evidence.outcome, 'ok');
        const node = kb.nodes.get(top.id)!;
        const voted = await call('set_properties', {
          workspace: 'main',
          node_id: top.id,
          properties: {
            votes: { 'user-1': 1, 'user-2': -1 },
            overlord: null,
            decline_reason: null
          },
          expected_metadata_revision: node.metadataRevision
        });
        assert.equal(voted.outcome, 'ok');
        assert.deepEqual(node.properties.votes, { 'user-1': 1, 'user-2': -1 });
        const lostRace = await call('set_properties', {
          workspace: 'main',
          node_id: top.id,
          properties: { status: 'ready' },
          expected_metadata_revision: node.metadataRevision - 1
        });
        assert.deepEqual([lostRace.outcome, lostRace.upstreamStatus], ['conflict', 412]);
        const serverOwned = await call('set_properties', {
          workspace: 'main',
          node_id: top.id,
          properties: { content_updated_at: '2020-01-01T00:00:00Z' },
          expected_metadata_revision: node.metadataRevision
        });
        assert.deepEqual([serverOwned.outcome, serverOwned.upstreamStatus], ['tool_error', 422]);
        const unlinked = await call('remove_relation', {
          workspace: 'main',
          relation_id: projectRel.id,
          expected_revision: kb.relations.get(projectRel.id)!.revision
        });
        assert.equal(unlinked.outcome, 'ok');
        assert.ok(!kb.relations.has(projectRel.id));
      }));

    it('a write after token expiry refreshes once and applies exactly once; disconnect revokes writes', () =>
      fixture(adapter, async ({ kb, rt }) => {
        const id = await connect(rt, kb);
        const mcp = rt.knowledgebase!;
        const grant = { connectionId: id, workspace: 'main' };
        kb.now += 2 * 3600 * 1000; // the access token has expired upstream
        const created = await mcp.call(
          owner,
          namespacedToolId(id, 'create_node'),
          { workspace: 'main', path: 'notes/after-refresh.md', expected_version: 'new' },
          undefined,
          { write: grant }
        );
        assert.equal(created.outcome, 'ok');
        assert.equal(
          [...kb.nodes.values()].filter(n => n.path === 'notes/after-refresh.md').length,
          1
        );
        assert.equal(kb.calls.filter(c => c.tool === 'create_node').length, 1);
        await rt.connections.disconnect(owner, id);
        assert.equal(await mcp.authorizeWrite(owner, grant), 'invalid');
        const after = await mcp.call(
          owner,
          namespacedToolId(id, 'create_node'),
          { workspace: 'main', path: 'notes/after-disconnect.md', expected_version: 'new' },
          undefined,
          { write: grant }
        );
        assert.notEqual(after.outcome, 'ok');
        assert.ok(![...kb.nodes.values()].some(n => n.path === 'notes/after-disconnect.md'));
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
    const { db, cleanup } = await createConformanceDatabase('sqlite', 'connections');
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
      // Turned off by the operator: nothing is served or started.
      const off = createConnectionsRuntime({
        db,
        env: { KNOWLEDGEBASE_MCP_URL: 'off' },
        publicBaseUrl: 'https://backend.test',
        webReturnOrigin: null,
        fetch: kb.fetch
      });
      await assert.rejects(
        off.connections.start(owner, { provider: 'knowledgebase', returnTo: 'mobile' }),
        rejectsCode('provider_not_ready')
      );
      assert.equal(off.clientMetadata(), null);
      // No key source at all (no BETTER_AUTH_SECRET, no explicit key): never a plaintext fallback.
      const keyless = createConnectionsRuntime({
        db,
        env: {},
        publicBaseUrl: 'https://backend.test',
        webReturnOrigin: null,
        fetch: kb.fetch
      });
      await assert.rejects(
        keyless.connections.start(owner, { provider: 'knowledgebase', returnTo: 'mobile' }),
        rejectsCode('provider_not_ready')
      );
    } finally {
      await cleanup();
    }
  });

  it('HTTP: metadata document, status-only callback redirects, owner-scoped routes, and the Local guard', async () => {
    const { db, cleanup } = await createConformanceDatabase('sqlite', 'connections');
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
    app.use(apiErrorHandler);
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

const AUTH_SECRET = 'deployment-better-auth-secret-0123456789abcdef';
const STANDARD_ORIGIN = new URL(DEFAULT_KNOWLEDGEBASE_MCP_URL).origin;

/** A backend booted with only what every Cloud deployment already has: no Knowledgebase variables. */
function freshRuntime(
  db: DatabaseClient,
  kb: FakeKnowledgebase,
  env: NodeJS.ProcessEnv = { BETTER_AUTH_SECRET: AUTH_SECRET }
) {
  return createConnectionsRuntime({
    db,
    env,
    publicBaseUrl: 'https://backend.test',
    webReturnOrigin: 'https://app.test',
    fetch: kb.fetch,
    now: () => kb.now
  });
}

async function freshConnect(rt: ReturnType<typeof freshRuntime>, kb: FakeKnowledgebase) {
  const started = await rt.connections.start(owner, { provider: 'knowledgebase', returnTo: 'web' });
  assert.deepEqual(await rt.connections.complete(kb.consent(started.authorizeUrl, 'kb-owner')), {
    status: 'connected',
    returnTo: 'web'
  });
  return started.connectionId;
}

describe('zero-setup Knowledgebase configuration (contract v156)', () => {
  it('defaults to the standard server, honours an HTTPS override, and can be turned off', () => {
    const standard = connectionsConfigFromEnv({}, 'https://b', null);
    assert.equal(standard.knowledgebase!.mcpUrl, DEFAULT_KNOWLEDGEBASE_MCP_URL);
    assert.equal(standard.knowledgebase!.source, 'default');
    assert.deepEqual(standard.knowledgebase!.egressOrigins, [STANDARD_ORIGIN]);
    const blank = connectionsConfigFromEnv({ KNOWLEDGEBASE_MCP_URL: '  ' }, 'https://b', null);
    assert.equal(blank.knowledgebase!.mcpUrl, DEFAULT_KNOWLEDGEBASE_MCP_URL);
    const override = connectionsConfigFromEnv(
      { KNOWLEDGEBASE_MCP_URL: KB_MCP_URL },
      'https://b',
      null
    );
    assert.equal(override.knowledgebase!.source, 'configured');
    assert.deepEqual(override.knowledgebase!.egressOrigins, [KB_ORIGIN]);
    for (const value of ['off', 'OFF', 'none', 'disabled', 'false'])
      assert.equal(
        connectionsConfigFromEnv({ KNOWLEDGEBASE_MCP_URL: value }, 'https://b', null).knowledgebase,
        null
      );
    for (const value of ['http://kb.test/mcp', 'https://user:pw@kb.test/mcp', 'not a url'])
      assert.throws(
        () => connectionsConfigFromEnv({ KNOWLEDGEBASE_MCP_URL: value }, 'https://b', null),
        ConnectionsConfigError
      );
  });

  it('derives a stable platform key from the deployment secret; an explicit key still wins', () => {
    const a = platformKeyFromSecret(AUTH_SECRET)!;
    const b = platformKeyFromSecret(` ${AUTH_SECRET} `)!;
    assert.equal(a.key.length, 32);
    assert.ok(isPlatformKeyId(a.id));
    assert.equal(a.id, b.id);
    assert.ok(a.key.equals(b.key));
    assert.ok(!a.key.equals(Buffer.from(AUTH_SECRET).subarray(0, 32)), 'never the raw secret');
    assert.ok(!a.id.includes(AUTH_SECRET.slice(0, 8)));
    assert.notEqual(platformKeyFromSecret(`${AUTH_SECRET}-rotated`)!.id, a.id);
    assert.equal(platformKeyFromSecret('short'), null, 'a weak secret is not a key root');
    assert.equal(platformKeyFromSecret(undefined), null);

    const platformOnly = connectionsConfigFromEnv(
      { BETTER_AUTH_SECRET: AUTH_SECRET },
      'https://b',
      null
    );
    assert.equal(platformOnly.encryption!.keyId, a.id);
    const explicit = connectionsConfigFromEnv(
      { BETTER_AUTH_SECRET: AUTH_SECRET, ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: KEY },
      'https://b',
      null
    );
    assert.equal(explicit.encryption!.keyId, 'k1');
    // A platform-looking explicit id is reserved, so it can never shadow the derived key.
    const reserved = connectionsConfigFromEnv(
      { ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: KEY, ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID: a.id },
      'https://b',
      null
    );
    assert.equal(reserved.encryption!.keyId, 'k1');
  });
});

for (const adapter of adapters)
  describe(`zero-setup Knowledgebase connection lifecycle [${adapter}]`, () => {
    async function world(
      fn: (ctx: { db: DatabaseClient; kb: FakeKnowledgebase }) => Promise<void>
    ) {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'connections');
      try {
        await seed(db);
        await fn({ db, kb: new FakeKnowledgebase({ origin: STANDARD_ORIGIN }) });
      } finally {
        await cleanup();
      }
    }
    const keyRow = (db: DatabaseClient, id: string) =>
      db.get<{
        credential_key_id: string | null;
        credential_ciphertext: string | null;
        state: string;
      }>(
        'SELECT credential_key_id, credential_ciphertext, state FROM account_connections WHERE id = ?',
        [id]
      );

    it('a fresh deployment connects the standard server with no Knowledgebase variables', () =>
      world(async ({ db, kb }) => {
        const rt = freshRuntime(db, kb);
        assert.equal(rt.config.knowledgebase!.mcpUrl, DEFAULT_KNOWLEDGEBASE_MCP_URL);
        const started = await rt.connections.start(owner, {
          provider: 'knowledgebase',
          returnTo: 'web'
        });
        const url = new URL(started.authorizeUrl);
        assert.equal(url.origin, STANDARD_ORIGIN);
        assert.equal(url.searchParams.get('resource'), DEFAULT_KNOWLEDGEBASE_MCP_URL);
        assert.equal(
          (await rt.connections.complete(kb.consent(started.authorizeUrl, 'kb-owner'))).status,
          'connected'
        );
        const [dto] = (await rt.connections.list(owner)).items;
        assert.equal(dto!.state, 'connected');
        assert.equal(dto!.serverUrl, DEFAULT_KNOWLEDGEBASE_MCP_URL);
        assert.deepEqual(dto!.authorizedWorkspaces, ['main', 'overlord']);
        const stored = await keyRow(db, started.connectionId);
        assert.ok(isPlatformKeyId(stored!.credential_key_id!));
        const everything =
          JSON.stringify(await db.all('SELECT * FROM account_connections')) + JSON.stringify(dto);
        assert.ok(!kb.leaks(everything), 'tokens are sealed, never stored or listed raw');
        assert.ok(!everything.includes(AUTH_SECRET));
        // The connection is usable for reads, and survives a restart of the same deployment.
        const restarted = freshRuntime(db, kb);
        const token = await restarted.connections.accessToken(owner, started.connectionId);
        assert.ok(token.accessToken.startsWith('kb_at_'));
        assert.ok(rt.clientMetadata());
      }));

    it('existing connections under an explicit key keep working and stay under it', () =>
      world(async ({ db, kb }) => {
        const explicitEnv = {
          BETTER_AUTH_SECRET: AUTH_SECRET,
          ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: KEY
        };
        const before = freshRuntime(db, kb, { ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: KEY });
        const id = await freshConnect(before, kb);
        assert.equal((await keyRow(db, id))!.credential_key_id, 'k1');
        const after = freshRuntime(db, kb, explicitEnv);
        assert.ok((await after.connections.accessToken(owner, id)).accessToken);
        assert.equal((await keyRow(db, id))!.credential_key_id, 'k1');
      }));

    it('adding an explicit key later re-seals platform-sealed credentials without reconnecting', () =>
      world(async ({ db, kb }) => {
        const id = await freshConnect(freshRuntime(db, kb), kb);
        const platformCipher = (await keyRow(db, id))!.credential_ciphertext;
        const rt = freshRuntime(db, kb, {
          BETTER_AUTH_SECRET: AUTH_SECRET,
          ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: KEY
        });
        const first = await rt.connections.accessToken(owner, id);
        const row = await keyRow(db, id);
        assert.equal(row!.credential_key_id, 'k1');
        assert.notEqual(row!.credential_ciphertext, platformCipher);
        assert.equal(row!.state, 'connected');
        // Same grant: re-sealing never refreshes or rotates the upstream token.
        assert.equal((await rt.connections.accessToken(owner, id)).accessToken, first.accessToken);
      }));

    it('a removed explicit key keeps the credential (unavailable); restoring it restores access', () =>
      world(async ({ db, kb }) => {
        const explicitEnv = {
          BETTER_AUTH_SECRET: AUTH_SECRET,
          ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: KEY
        };
        const id = await freshConnect(freshRuntime(db, kb, explicitEnv), kb);
        await assert.rejects(
          freshRuntime(db, kb).connections.accessToken(owner, id),
          (e: unknown) => e instanceof ConnectionAccessError && e.code === 'unavailable'
        );
        assert.equal((await keyRow(db, id))!.state, 'connected');
        assert.ok((await keyRow(db, id))!.credential_ciphertext);
        assert.ok(
          (await freshRuntime(db, kb, explicitEnv).connections.accessToken(owner, id)).accessToken
        );
      }));

    it('a rotated deployment secret is a rotated key: erase and ask to reconnect, then reconnect', () =>
      world(async ({ db, kb }) => {
        const id = await freshConnect(freshRuntime(db, kb), kb);
        const rotated = freshRuntime(db, kb, { BETTER_AUTH_SECRET: `${AUTH_SECRET}-rotated` });
        await assert.rejects(
          rotated.connections.accessToken(owner, id),
          (e: unknown) =>
            e instanceof ConnectionAccessError && e.code === 'reauthorization_required'
        );
        const [dto] = (await rotated.connections.list(owner)).items;
        assert.equal(dto!.state, 'reauthorization_required');
        assert.equal(dto!.lastErrorCode, 'credential_unreadable');
        assert.equal((await keyRow(db, id))!.credential_ciphertext, null);
        // Reconnect reuses the same connection and works under the new key.
        assert.equal(await freshConnect(rotated, kb), id);
        assert.ok((await rotated.connections.accessToken(owner, id)).accessToken);
      }));

    it('a cancelled sign-in stores nothing and the next Connect completes cleanly', () =>
      world(async ({ db, kb }) => {
        const rt = freshRuntime(db, kb);
        const started = await rt.connections.start(owner, {
          provider: 'knowledgebase',
          returnTo: 'web'
        });
        const { state } = kb.consent(started.authorizeUrl, 'kb-owner');
        assert.deepEqual(await rt.connections.complete({ state, error: 'access_denied' }), {
          status: 'denied',
          returnTo: 'web'
        });
        const [pending] = (await rt.connections.list(owner)).items;
        assert.equal(pending!.state, 'pending');
        assert.equal(pending!.lastErrorCode, 'authorization_denied');
        assert.equal((await keyRow(db, started.connectionId))!.credential_ciphertext, null);
        // A failed exchange (bad code) also stores nothing.
        const second = await rt.connections.start(owner, {
          provider: 'knowledgebase',
          returnTo: 'web'
        });
        const consent = kb.consent(second.authorizeUrl, 'kb-owner');
        assert.equal(
          (await rt.connections.complete({ state: consent.state, code: 'not-the-code' })).status,
          'failed'
        );
        assert.equal((await keyRow(db, started.connectionId))!.credential_ciphertext, null);
        assert.equal(await freshConnect(rt, kb), started.connectionId);
        const [connected] = (await rt.connections.list(owner)).items;
        assert.equal(connected!.state, 'connected');
        assert.equal(connected!.lastErrorCode, null);
        // Scoped to its owner and organization.
        assert.deepEqual((await rt.connections.list(other)).items, []);
        assert.deepEqual((await rt.connections.list(ownerElsewhere)).items, []);
      }));
  });

describe('zero-setup Knowledgebase over HTTP (contract v156)', () => {
  it('reports Knowledgebase available with no Knowledgebase variables and completes the web flow', async () => {
    const { db, cleanup } = await createConformanceDatabase('sqlite', 'connections');
    const kb = new FakeKnowledgebase({ origin: STANDARD_ORIGIN });
    const rt = freshRuntime(db, kb);
    const app = express();
    app.use(express.json());
    app.use(createConnectionsPublicRouter({ cloud: () => true, runtime: () => rt }));
    app.use(
      '/api/connections',
      createConnectionsRouter({ cloud: () => true, runtime: () => rt, owner: () => owner })
    );
    app.use(apiErrorHandler);
    const server = app.listen(0);
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await seed(db);
      const before = (await (await fetch(`${base}/api/connections?scope=all`)).json()) as {
        providers: { provider: string; available: boolean; reason: string | null }[];
      };
      assert.deepEqual(
        before.providers.find(p => p.provider === 'knowledgebase'),
        {
          provider: 'knowledgebase',
          scope: 'organization',
          credentialKind: 'oauth',
          available: true,
          reason: null
        }
      );
      const start = await fetch(`${base}/api/connections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'knowledgebase', returnTo: 'web' })
      });
      assert.equal(start.status, 200);
      const { authorizeUrl } = (await start.json()) as { authorizeUrl: string };
      const denied = await fetch(
        `${base}/api/connections/knowledgebase/callback?${new URLSearchParams({
          state: kb.consent(authorizeUrl, 'kb-owner').state,
          error: 'access_denied'
        })}`,
        { redirect: 'manual' }
      );
      assert.equal(
        denied.headers.get('location'),
        'https://app.test/settings/connections?provider=knowledgebase&status=denied'
      );
      const retry = (await (
        await fetch(`${base}/api/connections`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: 'knowledgebase', returnTo: 'web' })
        })
      ).json()) as { authorizeUrl: string };
      const done = await fetch(
        `${base}/api/connections/knowledgebase/callback?${new URLSearchParams(
          kb.consent(retry.authorizeUrl, 'kb-owner')
        )}`,
        { redirect: 'manual' }
      );
      assert.equal(
        done.headers.get('location'),
        'https://app.test/settings/connections?provider=knowledgebase&status=connected'
      );
      const listing = await (await fetch(`${base}/api/connections?scope=all`)).text();
      assert.equal(JSON.parse(listing).items[0].state, 'connected');
      assert.ok(!kb.leaks(listing));
    } finally {
      server.close();
      await cleanup();
    }
  });
});
