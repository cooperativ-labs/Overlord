import { knowledgebaseFeatureReference } from '@overlord/contract';
import { type DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { ChatAccess, overlordSourceChecker } from '../../packages/core/service/chat/access.ts';
import { Conversations } from '../../packages/core/service/chat/conversations.ts';
import { ChatProposals } from '../../packages/core/service/chat/proposals.ts';
import { ChatRuns } from '../../packages/core/service/chat/runs.ts';
import type { ChatOptions, ChatOwner } from '../../packages/core/service/chat/store.ts';
import {
  ChatToolGateway,
  FIND_FEATURE_MISSIONS_TOOL
} from '../../packages/core/service/chat/tools.ts';
import { createProject } from '../../packages/core/service/projects.ts';
import { seedServiceOperator } from '../../packages/core/service/test-helpers.ts';
import { createConnectionsRuntime } from '../connections/index.ts';
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
 * Feature handoff through the unified Knowledgebase connection (per:202.5h64, connector
 * objective C2, contract v155): the real connections runtime and outbound MCP client
 * against the fake Knowledgebase, real proposals/missions, and a scripted Gemini.
 * Fake-upstream validation only: no live Knowledgebase or Overlord credential is used.
 */
const owner: ChatOwner = { profileId: 'owner', organizationId: 'ws-a-org' };
const outsider: ChatOwner = { profileId: 'outsider', organizationId: 'ws-c-org' };
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
const responses = (req: GeminiRequest) =>
  req.contents
    .flatMap(c => c.parts)
    .filter(p => p.functionResponse)
    .map(p => p.functionResponse!.response as Record<string, unknown>);
/** A provider function response's data, or a direct gateway output's content. */
const data = (r: object) =>
  ('untrustedData' in r ? r.untrustedData : (r as { content: unknown }).content) as Record<
    string,
    unknown
  >;
const promptText = (req: GeminiRequest) =>
  req.contents
    .flatMap(c => c.parts)
    .map(p => p.text ?? '')
    .join('\n');

interface World {
  db: DatabaseClient;
  kb: FakeKnowledgebase;
  c: Conversations;
  runs: ChatRuns;
  proposals: ChatProposals;
  gateway: ChatToolGateway;
  connectionId: string;
  project: string;
  otherProject: string;
  tool(name: string): string;
}

const CATALOG = {
  agentCatalog: {
    agents: {
      codex: {
        models: [{ id: 'test-model', reasoningOptions: [] }],
        defaultModel: 'test-model',
        defaultReasoningEffort: null
      }
    }
  }
};

async function world(adapter: ConformanceAdapter, fn: (w: World) => Promise<void>) {
  const { db, cleanup } = await createConformanceDatabase(adapter, 'chat_feature_handoff');
  try {
    await seedServiceOperator({
      db,
      workspaceId: 'ws-a',
      profileId: 'owner',
      workspaceUserId: 'ws-a-owner'
    });
    await seedServiceOperator({
      db,
      workspaceId: 'ws-c',
      profileId: 'outsider',
      workspaceUserId: 'ws-c-outsider'
    });
    await db.run('UPDATE workspaces SET settings_json = ? WHERE id = ?', [
      JSON.stringify(CATALOG),
      'ws-a'
    ]);
    const access = new ChatAccess(db);
    const [grant] = await access.grants(owner, 'mission:create');
    const projectIds: string[] = [];
    for (const name of ['Clear Comply', 'Elsewhere']) {
      const p = await createProject({ ctx: access.context(grant!), name });
      const now = new Date().toISOString();
      await db.run(
        "INSERT INTO project_resources (id, workspace_id, project_id, resource_key, is_primary, access_mode, status, created_at, updated_at) VALUES (?, 'ws-a', ?, 'primary', ?, 'read_write', 'active', ?, ?)",
        [randomUUID(), p.id, db.dialect === 'sqlite' ? 1 : true, now, now]
      );
      projectIds.push(p.id);
    }
    const kb = new FakeKnowledgebase();
    const rt = createConnectionsRuntime({
      db,
      env: {
        KNOWLEDGEBASE_MCP_URL: KB_MCP_URL,
        ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: randomBytes(32).toString('base64url')
      },
      publicBaseUrl: 'https://backend.test',
      webReturnOrigin: 'https://app.test',
      fetch: kb.fetch,
      now: () => kb.now,
      checkers: { overlord: overlordSourceChecker(db) }
    });
    const started = await rt.connections.start(owner, {
      provider: 'knowledgebase',
      returnTo: 'web'
    });
    await rt.connections.complete(kb.consent(started.authorizeUrl, 'kb-owner'));
    const mcp = rt.knowledgebase!;
    const options: ChatOptions = {
      now: () => kb.now,
      checkSource: rt.checkSource,
      authorizeKnowledgebaseWrite: (o, g) => mcp.authorizeWrite(o, g)
    };
    await fn({
      db,
      kb,
      c: new Conversations(db, options),
      runs: new ChatRuns(db, options),
      proposals: new ChatProposals(db, options),
      gateway: new ChatToolGateway({ db, knowledgebase: mcp, now: () => kb.now }),
      connectionId: started.connectionId,
      project: projectIds[0]!,
      otherProject: projectIds[1]!,
      tool: name => namespacedToolId(started.connectionId, name)
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
}

function seedReadyFeature(kb: FakeKnowledgebase, workspace = 'main'): FakeNode {
  return kb.seedNode({
    workspace,
    path: 'features/offline-sync.md',
    type: 'feature',
    properties: { description: 'Offline sync', status: 'ready' }
  });
}

const find = (w: World, args: Record<string, unknown>, who: ChatOwner = owner) =>
  w.gateway.invoke({
    owner: who,
    runId: 'r',
    operationId: randomUUID(),
    name: FIND_FEATURE_MISSIONS_TOOL,
    arguments: args,
    declared: [
      {
        name: FIND_FEATURE_MISSIONS_TOOL,
        description: '',
        parameters: { type: 'object' }
      }
    ]
  });

const setProperties = (w: World, args: Record<string, unknown>) =>
  w.gateway.invoke({
    owner,
    runId: 'r',
    operationId: randomUUID(),
    name: w.tool('set_properties'),
    arguments: args,
    declared: [{ name: w.tool('set_properties'), description: '', parameters: {} }],
    knowledgebaseWrite: { connectionId: w.connectionId, workspace: 'main' }
  });

/** Missions created through the chat proposal flow, with a creation receipt. */
async function createMissionFromCard(w: World, objective: string, projectId = w.project) {
  const created = await w.c.create(owner, { clientRequestId: randomUUID(), text: 'drafts' });
  const a = await w.runs.claim('worker', {
    provider: 'fake',
    model: 'fake',
    configDigest: 'fake',
    checkpointVersion: 1
  });
  assert.ok(a);
  const card = await w.proposals.prepare(a, randomUUID(), {
    missions: [
      {
        key: 'm0',
        projectId,
        title: 'Offline sync',
        objectives: [
          {
            title: 'Implement',
            objective,
            resourceKey: 'primary',
            acceptanceCriteria: ['Works'],
            assignment: { agent: 'codex', model: 'test-model' }
          }
        ]
      }
    ]
  });
  const receipt = await w.proposals.create(owner, card.id, {
    clientRequestId: randomUUID(),
    expectedRevision: card.currentRevision
  });
  await w.runs.complete(a);
  return { thread: created.thread.id, receipt: receipt.receipt };
}

for (const adapter of adapters)
  describe(`assistant Feature handoff [${adapter}]`, () => {
    it('hands off a ready Feature as one draft mission, recovers it on repeat and links it under a guard', () =>
      world(adapter, async w => {
        const feature = seedReadyFeature(w.kb);
        const grant = { connectionId: w.connectionId, workspace: 'main' };
        const reference = knowledgebaseFeatureReference({
          origin: new URL(KB_MCP_URL).origin,
          workspace: 'main',
          nodeId: feature.id
        });
        let referenceLines = '';

        // Run 1: exhaustive lookup proves absence; the card carries the reference lines.
        const first = new ScriptedGemini([
          () => [
            call(FIND_FEATURE_MISSIONS_TOOL, {
              projectId: w.project,
              workspace: 'main',
              featureNodeId: feature.id
            })
          ],
          req => {
            const r = data(responses(req)[0]!);
            assert.equal(r.reference, reference);
            assert.equal(r.complete, true);
            assert.deepEqual(r.results, []);
            referenceLines = String(r.referenceLines);
            assert.ok(referenceLines.includes(reference));
            assert.ok(referenceLines.includes(`/n/${feature.id}`));
            return [
              call('prepare_proposal', {
                missions: [
                  {
                    key: 'm0',
                    projectId: w.project,
                    title: 'Offline sync',
                    objectives: [
                      {
                        title: 'Implement offline sync',
                        objective: `Offline sync.\n${referenceLines}`,
                        resourceKey: 'primary',
                        acceptanceCriteria: ['Works offline'],
                        assignment: { agent: 'codex', model: 'test-model' }
                      }
                    ]
                  }
                ]
              })
            ];
          },
          () => [text('Prepared a draft card. Tap Create to save it.')]
        ]);
        const created = await w.c.create(owner, {
          clientRequestId: randomUUID(),
          text: 'Hand off Offline sync to Overlord',
          knowledgebaseWrite: grant
        });
        await execute(w, runtime(w, first));
        assert.equal(
          Number((await w.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM missions'))!.n),
          0,
          'preparing a card creates nothing'
        );
        const [card] = (await w.c.snapshot(owner, created.thread.id)).openProposals;
        const createdCard = await w.proposals.create(owner, card!.id, {
          clientRequestId: randomUUID(),
          expectedRevision: card!.currentRevision
        });
        const missionId = createdCard.receipt.missions[0]!.missionId;
        const displayId = createdCard.receipt.missions[0]!.missionDisplayId;
        const mission = await w.db.get<{ status_type: string }>(
          'SELECT status_type FROM missions WHERE id = ?',
          [missionId]
        );
        assert.equal(mission!.status_type, 'draft', 'handoff creates a draft');
        const objectiveStates = await w.db.all<{ state: string }>(
          'SELECT state FROM objectives WHERE mission_id = ?',
          [missionId]
        );
        assert.deepEqual(
          objectiveStates.map(o => o.state),
          ['draft'],
          'handoff never launches'
        );

        // Run 2: the receipt is visible, a stale link write conflicts, and the retry
        // recovers the same mission instead of proposing another.
        const staleRevision = feature.metadataRevision;
        feature.properties = { ...feature.properties, tags: ['sync'] };
        feature.metadataRevision++;
        const second = new ScriptedGemini([
          req => {
            assert.ok(promptText(req).includes(displayId), 'creation receipt reaches the model');
            return [
              call(w.tool('set_properties'), {
                workspace: 'main',
                node_id: feature.id,
                properties: {
                  overlord: displayId,
                  overlord_url: `https://overlord.test/missions/${displayId}`,
                  status: 'in_development',
                  live_at: null
                },
                expected_metadata_revision: staleRevision
              })
            ];
          },
          req => {
            assert.equal(responses(req)[0]!.outcome, 'conflict');
            return [
              call(FIND_FEATURE_MISSIONS_TOOL, {
                projectId: w.project,
                workspace: 'main',
                featureNodeId: feature.id
              })
            ];
          },
          req => {
            const r = data(responses(req).at(-1)!);
            assert.equal(r.complete, true);
            const results = r.results as { displayId: string; statusType: string }[];
            assert.equal(results.length, 1, 'exactly one mission carries the reference');
            assert.equal(results[0]!.displayId, displayId);
            assert.equal(results[0]!.statusType, 'draft');
            return [
              call(w.tool('set_properties'), {
                workspace: 'main',
                node_id: feature.id,
                properties: {
                  overlord: displayId,
                  overlord_url: `https://overlord.test/missions/${displayId}`,
                  status: 'in_development',
                  live_at: null
                },
                expected_metadata_revision: feature.metadataRevision
              })
            ];
          },
          req => {
            assert.equal(responses(req).at(-1)!.outcome, 'ok');
            return [text(`Linked the Feature to ${displayId}.`)];
          }
        ]);
        await w.c.submit(owner, created.thread.id, {
          clientRequestId: randomUUID(),
          text: 'Link it now',
          knowledgebaseWrite: grant
        });
        await execute(w, runtime(w, second));
        assert.equal(feature.properties.overlord, displayId);
        assert.equal(feature.properties.status, 'in_development');
        assert.deepEqual(feature.properties.tags, ['sync'], 'the concurrent edit survives');
        assert.equal(
          Number((await w.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM missions'))!.n),
          1,
          'no second mission'
        );
        assert.equal(
          Number(
            (await w.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM execution_requests'))!.n
          ),
          0,
          'nothing was launched'
        );
      }));

    it('looks up by exact identity and project, pages exhaustively and reports concurrent duplicates', () =>
      world(adapter, async w => {
        const feature = seedReadyFeature(w.kb);
        const origin = new URL(KB_MCP_URL).origin;
        const reference = knowledgebaseFeatureReference({
          origin,
          workspace: 'main',
          nodeId: feature.id
        });
        // Same node id in another Knowledgebase workspace, a title-only mention, and the
        // right reference in the wrong Overlord project: none is this Feature's mission.
        const foreign = knowledgebaseFeatureReference({
          origin,
          workspace: 'overlord',
          nodeId: feature.id
        });
        await createMissionFromCard(w, `Other workspace.\nKnowledgebase Feature: ${foreign}`);
        await createMissionFromCard(w, 'Offline sync, mentioned by title only');
        await createMissionFromCard(w, `Elsewhere.\n${reference}`, w.otherProject);
        let r = data(
          await find(w, { projectId: w.project, workspace: 'main', featureNodeId: feature.id })
        );
        assert.deepEqual(r.results, []);
        assert.equal(r.complete, true);

        // Two concurrent handoffs both created a mission: both are reported.
        const a = await createMissionFromCard(w, `One.\nKnowledgebase Feature: ${reference}`);
        const b = await createMissionFromCard(w, `Two (${reference}).`);
        r = data(
          await find(w, {
            projectId: w.project,
            workspace: 'main',
            featureNodeId: feature.id.toUpperCase(),
            limit: 1
          })
        );
        const seen = [...(r.results as { missionId: string }[])];
        assert.equal(r.complete, false, 'a full page is never complete');
        while (!r.complete) {
          r = data(
            await find(w, {
              projectId: w.project,
              workspace: 'main',
              featureNodeId: feature.id,
              limit: 1,
              cursor: r.nextCursor
            })
          );
          seen.push(...(r.results as { missionId: string }[]));
        }
        assert.deepEqual(
          seen.map(m => m.missionId).sort(),
          [a.receipt.missions[0]!.missionId, b.receipt.missions[0]!.missionId].sort()
        );
        // A cursor is bound to its reference.
        const other = seedReadyFeature(w.kb);
        const cursorReuse = await find(w, {
          projectId: w.project,
          workspace: 'main',
          featureNodeId: other.id,
          limit: 1,
          cursor: data(
            await find(w, {
              projectId: w.project,
              workspace: 'main',
              featureNodeId: feature.id,
              limit: 1
            })
          ).nextCursor
        });
        assert.equal(cursorReuse.outcome, 'invalid_arguments');

        // Status changes are reported by canonical status type.
        await w.db.run("UPDATE missions SET status_type = 'cancelled' WHERE id = ?", [
          a.receipt.missions[0]!.missionId
        ]);
        r = data(
          await find(w, { projectId: w.project, workspace: 'main', featureNodeId: feature.id })
        );
        assert.deepEqual(
          (r.results as { missionId: string; statusType: string }[])
            .map(m => [m.missionId, m.statusType])
            .sort(),
          [
            [a.receipt.missions[0]!.missionId, 'cancelled'],
            [b.receipt.missions[0]!.missionId, 'draft']
          ].sort()
        );

        // Owner/workspace isolation: another organization's caller sees no project.
        const denied = await find(
          w,
          { projectId: w.project, workspace: 'main', featureNodeId: feature.id },
          outsider
        );
        assert.equal(denied.outcome, 'not_found');
      }));

    it('refuses a Feature link to a missing, unreadable or foreign mission before any request', () =>
      world(adapter, async w => {
        const feature = seedReadyFeature(w.kb);
        const sibling = seedReadyFeature(w.kb);
        const origin = new URL(KB_MCP_URL).origin;
        const siblings = await createMissionFromCard(
          w,
          `Sibling.\n${knowledgebaseFeatureReference({ origin, workspace: 'main', nodeId: sibling.id })}`
        );
        const plain = await createMissionFromCard(w, 'Hand-made mission without a reference');
        w.kb.calls.length = 0;
        const attempt = (overlord: unknown) =>
          setProperties(w, {
            workspace: 'main',
            node_id: feature.id,
            properties: { overlord, status: 'in_development' },
            expected_metadata_revision: feature.metadataRevision
          });
        assert.equal((await attempt('ws-a:999')).outcome, 'invalid_arguments');
        assert.equal(
          (await attempt(siblings.receipt.missions[0]!.missionDisplayId)).outcome,
          'invalid_arguments',
          "another Feature's mission is never linked"
        );
        assert.equal(w.kb.calls.filter(c => c.tool === 'set_properties').length, 0);
        // A mission that carries no Feature reference may be linked by hand.
        const manual = await attempt(plain.receipt.missions[0]!.missionDisplayId);
        assert.equal(manual.outcome, 'ok');
        // Remove link is always allowed and never touches the mission.
        const removed = await setProperties(w, {
          workspace: 'main',
          node_id: feature.id,
          properties: { overlord: null, overlord_url: null, status: 'ready', live_at: null },
          expected_metadata_revision: feature.metadataRevision
        });
        assert.equal(removed.outcome, 'ok');
        assert.ok(!('overlord' in feature.properties));
        const still = await w.db.get<{ deleted_at: string | null; status_type: string }>(
          'SELECT deleted_at, status_type FROM missions WHERE id = ?',
          [plain.receipt.missions[0]!.missionId]
        );
        assert.equal(still!.deleted_at, null);
        assert.equal(still!.status_type, 'draft');
      }));
  });
