import { type DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { Conversations } from '../../packages/core/service/chat/conversations.ts';
import { ChatRuns } from '../../packages/core/service/chat/runs.ts';
import type { ChatOptions, ChatOwner } from '../../packages/core/service/chat/store.ts';
import { ChatToolGateway } from '../../packages/core/service/chat/tools.ts';
import { type ConnectionsRuntime, createConnectionsRuntime } from '../connections/index.ts';
import {
  FakeKnowledgebase,
  type FakeNode,
  KB_MCP_URL
} from '../connections/knowledgebase-test-fixture.ts';
import { namespacedToolId } from '../connections/policy.ts';
import {
  type ConformanceAdapter,
  conformanceAdapters,
  createConformanceDatabase
} from '../test-helpers.ts';

import type { GeminiChunk, GeminiClient, GeminiPart, GeminiRequest } from './gemini-client.ts';
import { GeminiChatRuntime } from './gemini-runtime.ts';

/**
 * Assistant Knowledgebase writes end to end (per:202.62e3, contract v154): the real
 * connections runtime and outbound MCP client against the fake Knowledgebase, driven
 * by a scripted Gemini through the durable run seam. Fake-upstream validation only:
 * no live Knowledgebase credential is involved.
 */
const owner: ChatOwner = { profileId: 'owner', organizationId: 'org' };
const other: ChatOwner = { profileId: 'other', organizationId: 'org' };
const adapters = conformanceAdapters();

class ScriptedGemini implements GeminiClient {
  readonly requests: GeminiRequest[] = [];
  constructor(private readonly script: ((req: GeminiRequest) => GeminiPart[])[]) {}
  async stream(request: GeminiRequest): Promise<AsyncIterable<GeminiChunk>> {
    this.requests.push(
      structuredClone({ ...request, config: { ...request.config, abortSignal: undefined } })
    );
    const step = this.script.shift();
    if (!step) throw new Error('script exhausted');
    const parts = step(request);
    return (async function* () {
      yield { candidates: [{ content: { parts } }] };
    })();
  }
  async generate() {
    return { text: 'summary' };
  }
}
const call = (name: string, args: Record<string, unknown>): GeminiPart => ({
  functionCall: { name, args }
});
const text = (t: string): GeminiPart => ({ text: t });
const declaredNames = (req: GeminiRequest) =>
  (req.config.tools?.[0]?.functionDeclarations ?? []).map(d => d.name);
/** The function responses of the latest provider request, in call order. */
const responses = (req: GeminiRequest) =>
  req.contents
    .flatMap(c => c.parts)
    .filter(p => p.functionResponse)
    .map(p => p.functionResponse!.response as Record<string, unknown>);

class Crash extends Error {}

interface World {
  db: DatabaseClient;
  kb: FakeKnowledgebase;
  c: Conversations;
  runs: ChatRuns;
  gateway: ChatToolGateway;
  connections: ConnectionsRuntime['connections'];
  mcp: NonNullable<ConnectionsRuntime['knowledgebase']>;
  connectionId: string;
  advance(ms: number): void;
  tool(name: string): string;
}

async function world(adapter: ConformanceAdapter, fn: (w: World) => Promise<void>) {
  const { db, cleanup } = await createConformanceDatabase(adapter, 'chat_kb_writes');
  try {
    const kb = new FakeKnowledgebase();
    const stamp = new Date(kb.now).toISOString();
    const f = db.dialect === 'sqlite' ? '0' : 'FALSE';
    for (const id of ['owner', 'other'])
      await db.run(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, ${f}, ?, ?)`,
        [id, id, `${id}@test.invalid`, stamp, stamp]
      );
    await db.run(
      "INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'org', ?, ?)",
      [stamp, stamp]
    );
    await db.run(
      "INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at) VALUES ('ws-org', 'org', 'ws-org', 'org', 'hosted', ?, ?)",
      [stamp, stamp]
    );
    for (const id of ['owner', 'other'])
      await db.run(
        "INSERT INTO workspace_users (id, workspace_id, profile_id, member_key, status, created_at, updated_at) VALUES (?, 'ws-org', ?, ?, 'active', ?, ?)",
        [`m-${id}`, id, id, stamp, stamp]
      );
    const rt = createConnectionsRuntime({
      db,
      env: {
        KNOWLEDGEBASE_MCP_URL: KB_MCP_URL,
        ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: randomBytes(32).toString('base64url')
      },
      publicBaseUrl: 'https://backend.test',
      webReturnOrigin: 'https://app.test',
      fetch: kb.fetch,
      now: () => kb.now
    });
    const started = await rt.connections.start(owner, {
      provider: 'knowledgebase',
      returnTo: 'web'
    });
    await rt.connections.complete(kb.consent(started.authorizeUrl, 'kb-owner'));
    const connectionId = started.connectionId;
    const mcp = rt.knowledgebase!;
    const options: ChatOptions = {
      now: () => kb.now,
      checkSource: rt.checkSource,
      authorizeKnowledgebaseWrite: (o, grant) => mcp.authorizeWrite(o, grant)
    };
    await fn({
      db,
      kb,
      c: new Conversations(db, options),
      runs: new ChatRuns(db, options),
      gateway: new ChatToolGateway({ db, knowledgebase: mcp, now: () => kb.now }),
      connections: rt.connections,
      mcp,
      connectionId,
      advance: ms => {
        kb.now += ms;
      },
      tool: name => namespacedToolId(connectionId, name)
    });
  } finally {
    await cleanup();
  }
}

const runtime = (w: World, client: GeminiClient) =>
  new GeminiChatRuntime({ client, gateway: w.gateway, coalesceMs: 0, summaryEveryMessages: 100 });

async function execute(w: World, rt: GeminiChatRuntime) {
  const a = await w.runs.claim('worker', rt.identity);
  assert.ok(a, 'a run is claimable');
  await rt.execute(a, w.runs, new AbortController().signal);
  return a;
}

function seedFeatureProject(kb: FakeKnowledgebase) {
  const project = kb.seedNode({
    workspace: 'main',
    path: 'projects/clear-comply.md',
    type: 'project'
  });
  const feature: FakeNode = kb.seedNode({
    workspace: 'main',
    path: 'features/offline-sync.md',
    type: 'feature',
    properties: { description: 'Offline sync', status: 'idea', votes: { 'user-a': 1 } }
  });
  const projectRel = kb.seedRelation({
    workspace: 'main',
    from: feature.id,
    to: project.id,
    type: 'project',
    attributes: { rank: 2, rank_rationale: 'Asked by two customers', note: 'keep me' }
  });
  const meeting = kb.seedNode({ workspace: 'main', path: 'meetings/2026-10-01.md' });
  return { project, feature, projectRel, meeting };
}

for (const adapter of adapters)
  describe(`assistant Knowledgebase writes [${adapter}]`, () => {
    it('a research-only run offers no write tool and refuses a forged write without reaching the Knowledgebase', () =>
      world(adapter, async w => {
        const gemini = new ScriptedGemini([
          () => [
            call(w.tool('create_node'), {
              workspace: 'main',
              path: 'notes/x.md',
              expected_version: 'new'
            })
          ],
          () => [text('I can only read your notes in this conversation.')]
        ]);
        const created = await w.c.create(owner, {
          clientRequestId: randomUUID(),
          text: 'Summarize my offline notes'
        });
        assert.equal(created.run!.knowledgebaseWrite, null);
        await execute(w, runtime(w, gemini));
        const names = declaredNames(gemini.requests[0]!);
        assert.ok(names.includes(w.tool('query')), 'reviewed query is a read');
        assert.ok(names.includes(w.tool('get_registries')));
        assert.ok(!names.some(n => /create_node|edit_file|set_properties|_relation$/.test(n)));
        assert.equal(responses(gemini.requests[1]!)[0]!.outcome, 'unknown_tool');
        assert.equal(w.kb.calls.filter(c => c.tool === 'create_node').length, 0);
        assert.equal(w.kb.nodes.size, 0);
      }));

    it('writes a linked note and Feature metadata only within the granted workspace, with receipts and conflicts', () =>
      world(adapter, async w => {
        const { feature, projectRel, meeting } = seedFeatureProject(w.kb);
        const grant = { connectionId: w.connectionId, workspace: 'main' };
        const gemini = new ScriptedGemini([
          // Reads and writes requested together: the reads run first, the writes in call order.
          () => [
            call(w.tool('query'), {
              workspace: 'main',
              type: 'feature',
              where_in: { status: ['idea', 'shaping', 'ready'] },
              where_empty: ['overlord'],
              include: ['properties', 'relations'],
              limit: 100
            }),
            call(w.tool('create_node'), {
              workspace: 'main',
              path: 'notes/offline-call.md',
              expected_version: 'new',
              content: '# Offline call\nproject:: [[Clear Comply]]\n'
            }),
            call(w.tool('set_properties'), {
              workspace: 'main',
              node_id: feature.id,
              properties: {
                votes: { 'user-a': 1, 'user-b': 1 },
                tags: ['sync', 'mobile'],
                stale_key: null
              },
              expected_metadata_revision: feature.metadataRevision
            }),
            call(w.tool('add_relation'), {
              workspace: 'main',
              from_node_id: feature.id,
              to_node_id: meeting.id,
              relation_type: 'supported_by',
              attributes: {
                citations: [
                  { quote: 'We lose work offline', locator: '00:12:30', stance: 'for' },
                  {
                    quote: 'Sync conflicts scare us',
                    locator: '00:31:02',
                    stance: 'for',
                    note: null
                  }
                ]
              }
            }),
            // Stale relation revision: refused by the guard, never overwrites.
            call(w.tool('update_relation'), {
              workspace: 'main',
              relation_id: projectRel.id,
              attributes: { rank: 1 },
              expected_revision: projectRel.revision + 5
            }),
            // Outside the grant's workspace: refused before any request.
            call(w.tool('create_node'), {
              workspace: 'overlord',
              path: 'notes/elsewhere.md',
              expected_version: 'new'
            })
          ],
          () => [text('Saved the call note, updated votes and tags, and added two citations.')]
        ]);
        const created = await w.c.create(owner, {
          clientRequestId: randomUUID(),
          text: 'Record this call in my Knowledgebase and add it as evidence for offline sync',
          knowledgebaseWrite: grant
        });
        assert.deepEqual(created.run!.knowledgebaseWrite, grant);
        w.kb.calls.length = 0;
        const preVotes = structuredClone(feature.properties);
        preVotes.stale_key = 'remove me';
        feature.properties = preVotes;
        await execute(w, runtime(w, gemini));

        const names = declaredNames(gemini.requests[0]!);
        for (const tool of [
          'create_node',
          'edit_file',
          'set_properties',
          'add_relation',
          'update_relation',
          'remove_relation'
        ])
          assert.ok(names.includes(w.tool(tool)), `${tool} is offered under the grant`);
        const [query, note, props, evidence, stale, foreign] = responses(gemini.requests[1]!);
        assert.equal(query!.outcome, 'ok');
        assert.equal(note!.outcome, 'ok');
        assert.equal(props!.outcome, 'ok');
        assert.equal(evidence!.outcome, 'ok');
        assert.equal(stale!.outcome, 'conflict');
        assert.equal(foreign!.outcome, 'denied');
        // Upstream order: the read first, then each write once, in call order.
        assert.deepEqual(
          w.kb.calls.map(c => c.tool).filter(t => t !== 'get_related' && t !== 'list_workspaces'),
          ['query', 'create_node', 'set_properties', 'add_relation', 'update_relation']
        );
        const stored = [...w.kb.nodes.values()].find(n => n.path === 'notes/offline-call.md');
        assert.ok(stored?.content.includes('project:: [[Clear Comply]]'));
        assert.deepEqual(feature.properties.votes, { 'user-a': 1, 'user-b': 1 });
        assert.deepEqual(feature.properties.tags, ['sync', 'mobile']);
        assert.ok(!('stale_key' in feature.properties), 'null removes the property');
        const support = [...w.kb.relations.values()].find(r => r.type === 'supported_by');
        assert.equal((support!.attributes.citations as unknown[]).length, 2);
        assert.deepEqual(projectRel.attributes, {
          rank: 2,
          rank_rationale: 'Asked by two customers',
          note: 'keep me'
        });
        // Receipts: write calls are recorded with their progress label.
        const labels = await w.db.all<{ payload_json: string }>(
          "SELECT payload_json FROM chat_events WHERE kind = 'tool.updated'"
        );
        assert.ok(labels.some(e => String(e.payload_json).includes('Updating notes')));
        const receipts = await w.db.all<{ tool_id: string; state: string }>(
          'SELECT tool_id, state FROM chat_tool_calls ORDER BY turn_index, call_order'
        );
        assert.equal(receipts.length, 6);
        assert.ok(receipts.every(r => r.state === 'completed'));
      }));

    it('a connection allowing all workspaces writes in every authorized workspace without a grant, and turning it off applies at once', () =>
      world(adapter, async w => {
        const before = (await w.connections.list(owner)).items[0]!;
        assert.equal(before.assistantWriteScope, 'per_request');
        const setScope = (body: unknown, as: ChatOwner = owner) =>
          w.connections.update(as, w.connectionId, body);
        await assert.rejects(
          setScope({ expectedRevision: before.revision, assistantWriteScope: 'everything' }),
          { code: 'invalid_request' }
        );
        await assert.rejects(
          setScope({
            expectedRevision: before.revision,
            assistantWriteScope: 'all_workspaces',
            extra: 1
          }),
          { code: 'invalid_request' }
        );
        await assert.rejects(
          setScope({
            expectedRevision: before.revision + 1,
            assistantWriteScope: 'all_workspaces'
          }),
          { code: 'stale_revision' }
        );
        await assert.rejects(
          setScope(
            { expectedRevision: before.revision, assistantWriteScope: 'all_workspaces' },
            other
          ),
          { code: 'not_found' }
        );
        const enabled = await setScope({
          expectedRevision: before.revision,
          assistantWriteScope: 'all_workspaces'
        });
        assert.equal(enabled.assistantWriteScope, 'all_workspaces');
        assert.equal(enabled.revision, before.revision + 1);

        const gemini = new ScriptedGemini([
          () => [
            call(w.tool('create_node'), {
              workspace: 'main',
              path: 'notes/main.md',
              expected_version: 'new'
            }),
            call(w.tool('create_node'), {
              workspace: 'overlord',
              path: 'notes/overlord.md',
              expected_version: 'new'
            }),
            // Not authorized for this account even after a refresh: refused before any write.
            call(w.tool('create_node'), {
              workspace: 'private',
              path: 'notes/private.md',
              expected_version: 'new'
            })
          ],
          () => [text('Saved notes in main and overlord.')]
        ]);
        const created = await w.c.create(owner, {
          clientRequestId: randomUUID(),
          text: 'Record this in both workspaces'
        });
        assert.equal(created.run!.knowledgebaseWrite, null, 'no per-request grant is stored');
        await execute(w, runtime(w, gemini));
        const declaration = (
          gemini.requests[0]!.config.tools?.[0]?.functionDeclarations ?? []
        ).find(d => d.name === w.tool('create_node'));
        assert.ok(declaration, 'write tools are offered without a grant');
        assert.match(String(declaration.description), /every workspace.*"main", "overlord"/);
        const [main, overlord, foreign] = responses(gemini.requests[1]!);
        assert.equal(main!.outcome, 'ok');
        assert.equal(overlord!.outcome, 'ok');
        assert.equal(foreign!.outcome, 'denied');
        assert.deepEqual([...w.kb.nodes.values()].map(n => `${n.workspace}/${n.path}`).sort(), [
          'main/notes/main.md',
          'overlord/notes/overlord.md'
        ]);

        // Turned off: the next write is refused even with tools declared earlier.
        await setScope({ expectedRevision: enabled.revision, assistantWriteScope: 'per_request' });
        const refused = await w.mcp.call(owner, w.tool('create_node'), {
          workspace: 'main',
          path: 'notes/after.md',
          expected_version: 'new'
        });
        assert.equal(refused.detail, 'write_not_authorized');
        assert.ok(
          !(await w.mcp.tools(owner)).some(t => t.access === 'write'),
          'per_request offers no write tool without a grant'
        );
        assert.equal(w.kb.calls.filter(c => c.tool === 'create_node').length, 2);
      }));

    it('a write interrupted after it was sent becomes uncertain and is never re-sent on recovery', () =>
      world(adapter, async w => {
        const grant = { connectionId: w.connectionId, workspace: 'main' };
        const createArgs = {
          workspace: 'main',
          path: 'notes/decision.md',
          expected_version: 'new',
          content: 'Decision: ship offline mode'
        };
        await w.c.create(owner, {
          clientRequestId: randomUUID(),
          text: 'Save this decision to my notes',
          knowledgebaseWrite: grant
        });
        // First attempt: the write reaches the Knowledgebase, then the worker dies before
        // its result is recorded.
        const first = new ScriptedGemini([() => [call(w.tool('create_node'), createArgs)]]);
        const rt1 = runtime(w, first);
        const dying = new Proxy(w.runs, {
          get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (prop !== 'toolResult' || typeof value !== 'function') return value;
            return async () => {
              throw new Crash();
            };
          }
        });
        const a1 = await w.runs.claim('worker-1', rt1.identity);
        await assert.rejects(rt1.execute(a1!, dying, new AbortController().signal), Crash);
        assert.equal(w.kb.calls.filter(c => c.tool === 'create_node').length, 1);
        assert.equal(
          (await w.db.get<{ state: string }>('SELECT state FROM chat_tool_calls'))!.state,
          'executing'
        );
        // Recovery after the lease lapses: the receipt is resolved as uncertain, not retried.
        w.advance(10 * 60 * 1000);
        const second = new ScriptedGemini([
          req => {
            assert.equal(responses(req)[0]!.outcome, 'uncertain');
            return [call(w.tool('read_file'), { workspace: 'main', path: 'notes/decision.md' })];
          },
          () => [text('The decision note was already saved.')]
        ]);
        await execute(w, runtime(w, second));
        assert.equal(
          w.kb.calls.filter(c => c.tool === 'create_node').length,
          1,
          'the uncertain create is never repeated'
        );
        const row = await w.db.get<{ state: string; error_code: string }>(
          "SELECT state, error_code FROM chat_tool_calls WHERE tool_id LIKE '%create_node'"
        );
        assert.deepEqual({ ...row }, { state: 'failed', error_code: 'uncertain_write' });
        assert.equal(
          [...w.kb.nodes.values()].filter(n => n.path === 'notes/decision.md').length,
          1
        );
      }));

    it('a lost write response is reported uncertain, and a retry is caught by the guard instead of duplicating', () =>
      world(adapter, async w => {
        const grant = { connectionId: w.connectionId, workspace: 'main' };
        const args = { workspace: 'main', path: 'notes/once.md', expected_version: 'new' };
        w.kb.loseResponseAfter = 'create_node';
        const gemini = new ScriptedGemini([
          () => [call(w.tool('create_node'), args)],
          req => {
            assert.equal(responses(req)[0]!.outcome, 'uncertain');
            return [call(w.tool('create_node'), args)];
          },
          req => {
            assert.equal(responses(req).at(-1)!.outcome, 'conflict');
            return [text('It already exists.')];
          }
        ]);
        await w.c.create(owner, {
          clientRequestId: randomUUID(),
          text: 'Create a note',
          knowledgebaseWrite: grant
        });
        await execute(w, runtime(w, gemini));
        assert.equal([...w.kb.nodes.values()].filter(n => n.path === 'notes/once.md').length, 1);
      }));

    it('grants are validated at submission and re-checked against the live connection at execution', () =>
      world(adapter, async w => {
        const grant = { connectionId: w.connectionId, workspace: 'main' };
        const rejects = (code: string) => (e: unknown) =>
          Boolean(e && typeof e === 'object' && (e as { code?: unknown }).code === code);
        const thread = (await w.c.create(owner)).thread.id;
        // Not the owner's workspace grant, another owner's connection, or a malformed grant.
        await assert.rejects(
          w.c.submit(owner, thread, {
            clientRequestId: 'a',
            text: 'x',
            knowledgebaseWrite: { ...grant, workspace: 'secret' }
          }),
          rejects('invalid_request')
        );
        const otherThread = (await w.c.create(other)).thread.id;
        await assert.rejects(
          w.c.submit(other, otherThread, {
            clientRequestId: 'b',
            text: 'x',
            knowledgebaseWrite: grant
          }),
          rejects('invalid_request')
        );
        await assert.rejects(
          w.c.submit(owner, thread, {
            clientRequestId: 'c',
            text: 'x',
            knowledgebaseWrite: { connectionId: 'nope', workspace: 'main' }
          }),
          rejects('invalid_request')
        );
        // Accepted, then the upstream restricts the connection to read-only: Knowledgebase
        // permissions stay authoritative and the refusal reaches the model as an error.
        w.kb.readOnlyUsers.add('kb-owner');
        const gemini = new ScriptedGemini([
          () => [
            call(w.tool('create_node'), {
              workspace: 'main',
              path: 'n.md',
              expected_version: 'new'
            })
          ],
          req => {
            const r = responses(req)[0]!;
            assert.equal(r.outcome, 'tool_error');
            assert.equal((r.untrustedData as { upstreamStatus?: number }).upstreamStatus, 403);
            return [text('Your Knowledgebase connection cannot edit that workspace.')];
          }
        ]);
        await w.c.submit(owner, thread, {
          clientRequestId: 'd',
          text: 'x',
          knowledgebaseWrite: grant
        });
        await execute(w, runtime(w, gemini));
        assert.equal(w.kb.nodes.size, 0);
      }));
  });
