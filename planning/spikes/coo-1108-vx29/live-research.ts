/* eslint-disable no-console -- live proof harness */
// coo:1108.vx29 live proof — NOT production code and NOT a contracted interface.
//
// Real: Gemini (`gemini-3.8-flash`) through the production `GeminiChatRuntime`, the
// production tool gateway, durable conversation services, ChatWorker scheduling, and
// repository reads through `performRepositoryRead` → the mission-less runner queue → the
// real claim → the target-side read code (`InProcessProvider` + `executeLocalTargetMutation`,
// the code the runner executes) against this machine's Overlord and OverlordMobile
// checkouts. Knowledgebase reads use the production `KnowledgebaseMcp` client and
// connections module, but the server is the in-memory `FakeKnowledgebase` with a seeded
// note, because the real Knowledgebase sign-in is still blocked (see zb9x findings).
//
// Logs and results carry ids, counts, outcomes and the assistant's answers; never keys,
// tokens, checkpoint payloads or thought signatures.
//
// Usage: node --import tsx planning/spikes/coo-1108-vx29/live-research.ts

import { createSqliteClient, openInMemoryDatabase } from '@overlord/database';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chatSourceCheckers } from '../../../backend/chat/engine.ts';
import {
  sdkGeminiClient,
  type GeminiClient,
  type GeminiRequest
} from '../../../backend/chat/gemini-client.ts';
import { GeminiChatRuntime } from '../../../backend/chat/gemini-runtime.ts';
import { ChatWorker } from '../../../backend/chat-worker.ts';
import { FakeKnowledgebase, KB_MCP_URL } from '../../../backend/connections/fake-knowledgebase.ts';
import { createConnectionsRuntime } from '../../../backend/connections/index.ts';
import { Conversations } from '../../../packages/core/service/chat/conversations.ts';
import { ChatRuns } from '../../../packages/core/service/chat/runs.ts';
import { ChatToolGateway } from '../../../packages/core/service/chat/tools.ts';
import {
  createServiceContext,
  type ServiceContext
} from '../../../packages/core/service/context.ts';
import { claimNextExecutionRequest } from '../../../packages/core/service/execution-requests.ts';
import { recordRunnerHeartbeat } from '../../../packages/core/service/execution-target-runners.ts';
import { InProcessProvider } from '../../../packages/core/service/local-target/in-process-provider.ts';
import { executeLocalTargetMutation } from '../../../packages/core/service/local-target-mutation-runner.ts';
import {
  completeLocalTargetMutationRequest,
  parseLocalTargetMutation
} from '../../../packages/core/service/local-target-mutations.ts';
import { createProject } from '../../../packages/core/service/projects.ts';
import { performRepositoryRead } from '../../../packages/core/service/repository-reads.ts';
import { seedServiceOperator } from '../../../packages/core/service/test-helpers.ts';
import { newId, nowIso } from '../../../packages/core/service/util.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const MOBILE = path.resolve(ROOT, '../OverlordMobile');
const NOTE = `# Offline support — design notes (2026-09)
Goal: the phone keeps working without the backend for capture and reading.
- Capture: queue new missions/objectives locally and replay them in order on reconnect; today OfflineObjectiveStore only queues a failed mission create.
- Reading: cache the mission list and mission detail; show staleness.
- Sync: the backend needs idempotent creates keyed by client request ids so replays cannot duplicate.
- Open question: whether the desktop app should cache for Local mode too.`;

function env(): string {
  const file = readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const line = file.split('\n').find(l => /^GEMINI_API_KEY=/.test(l));
  const key = line
    ?.slice('GEMINI_API_KEY='.length)
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!key) throw new Error('GEMINI_API_KEY missing from .env.local');
  return key;
}

/** Records provider requests (roles and part kinds only) for the report. */
function recording(client: GeminiClient, log: GeminiRequest[]): GeminiClient {
  return {
    stream: req => {
      log.push(req);
      return client.stream(req);
    },
    generate: req => client.generate(req)
  };
}

async function seedTarget(ctx: ServiceContext) {
  const now = nowIso();
  const overlord = await createProject({ ctx, name: 'Overlord' });
  const mobile = await createProject({ ctx, name: 'OverlordMobile' });
  const deviceId = newId(),
    executionTargetId = newId();
  await ctx.db.run(
    `INSERT INTO devices (id, workspace_id, fingerprint, label, platform, status, last_seen_at, metadata_json, created_at, updated_at, revision) VALUES (?, ?, ?, 'Jake Mac', 'darwin', 'active', ?, '{}', ?, ?, 1)`,
    [deviceId, ctx.workspace.id, `fp-${randomUUID()}`, now, now, now]
  );
  await ctx.db.run(
    `INSERT INTO execution_targets (id, workspace_id, device_id, owner_workspace_user_id, type, label, status, connection_json, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 'local', 'Jake Mac', 'active', '{}', ?, ?, 1)`,
    [executionTargetId, ctx.workspace.id, deviceId, ctx.actorWorkspaceUserId, now, now]
  );
  await ctx.db.run(
    `INSERT INTO workspace_user_execution_targets (id, workspace_id, workspace_user_id, execution_target_id, access_status, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`,
    [newId(), ctx.workspace.id, ctx.actorWorkspaceUserId, executionTargetId, now, now]
  );
  for (const [project, dir] of [
    [overlord, ROOT],
    [mobile, MOBILE]
  ] as const) {
    const resourceId = newId();
    await ctx.db.run(
      `INSERT INTO project_resources (id, workspace_id, project_id, resource_key, label, is_primary, status, metadata_json, created_at, updated_at, revision) VALUES (?, ?, ?, 'primary', ?, 1, 'active', '{}', ?, ?, 1)`,
      [resourceId, ctx.workspace.id, project.id, project.name, now, now]
    );
    await ctx.db.run(
      `INSERT INTO project_resource_sources (id, workspace_id, project_id, resource_id, execution_target_id, source_kind, descriptor_json, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, 'local_checkout', ?, ?, ?, 1)`,
      [
        newId(),
        ctx.workspace.id,
        project.id,
        resourceId,
        executionTargetId,
        JSON.stringify({ path: dir }),
        now,
        now
      ]
    );
  }
  await recordRunnerHeartbeat({
    ctx,
    executionTargetId,
    runnerInstanceId: 'live-proof-runner',
    relation: 'adopted'
  });
  return { executionTargetId, overlordId: overlord.id, mobileId: mobile.id };
}

/** The runner loop: real claim, real target-side read code, real completion. */
function startRunner(ctx: ServiceContext, executionTargetId: string) {
  let stopped = false;
  const executed: string[] = [];
  void (async () => {
    while (!stopped) {
      const claimed = await claimNextExecutionRequest({
        ctx,
        runner: { executionTargetId, runnerInstanceId: 'live-proof-runner', relation: 'adopted' }
      }).catch(() => null);
      if (!claimed) {
        await new Promise(r => setTimeout(r, 20));
        continue;
      }
      const mutation = parseLocalTargetMutation(claimed.metadata);
      if (!mutation) continue;
      executed.push(mutation.capability);
      const result = await executeLocalTargetMutation({
        mutation,
        provider: new InProcessProvider({
          executionTargetId,
          deviceLabel: null,
          transport: 'in_process'
        }),
        workingDirectory: claimed.workingDirectory
      });
      await completeLocalTargetMutationRequest({ ctx, requestId: claimed.id, result });
      await recordRunnerHeartbeat({
        ctx,
        executionTargetId,
        runnerInstanceId: 'live-proof-runner',
        relation: 'adopted'
      });
    }
  })();
  return { stop: () => (stopped = true), executed };
}

async function waitTerminal(
  c: Conversations,
  owner: { profileId: string; organizationId: string },
  threadId: string,
  ms = 240_000
) {
  const until = Date.now() + ms;
  for (;;) {
    const snap = await c.snapshot(owner, threadId);
    if (!snap.activeRun || snap.activeRun.state === 'waiting_user') return snap;
    if (Date.now() > until) throw new Error('timed out waiting for the run');
    await new Promise(r => setTimeout(r, 500));
  }
}

const shape = (log: GeminiRequest[]) =>
  log.map(r => ({
    contents: r.contents.map(
      c =>
        `${c.role}:${c.parts.map(p => (p.functionCall ? `call(${p.functionCall.name})${p.thoughtSignature ? '+sig' : ''}` : p.functionResponse ? `response(${p.functionResponse.name})` : p.text ? 'text' : 'other')).join(',')}`
    ),
    mode: r.config.toolConfig?.functionCallingConfig.mode
  }));

async function main() {
  const report: Record<string, unknown> = {
    model: 'gemini-3.8-flash',
    startedAt: new Date().toISOString()
  };
  const db = createSqliteClient(openInMemoryDatabase());
  await seedServiceOperator({ db });
  const ctx = await createServiceContext({ db, source: 'webapp' });
  const owner = { profileId: 'operator-user', organizationId: 'local-workspace-org' };
  const seeded = await seedTarget(ctx);
  const runner = startRunner(ctx, seeded.executionTargetId);

  // Knowledgebase: production connections module and MCP client over the in-memory server.
  const kb = new FakeKnowledgebase();
  kb.now = Date.now();
  const fakeFetch = kb.fetch;
  const kbFetch: typeof kb.fetch = async (input, init) => {
    let body: {
      method?: string;
      id?: number;
      params?: { name?: string; arguments?: { path?: string } };
    } | null = null;
    try {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    } catch {
      body = null; // Form-encoded OAuth requests go to the fake unchanged.
    }
    if (
      body?.method === 'tools/call' &&
      ['read_file', 'search'].includes(body.params?.name ?? '')
    ) {
      const payload =
        body.params?.name === 'search'
          ? {
              results: [
                {
                  id: kb.nodeId,
                  path: 'projects/offline-support.md',
                  title: 'Offline support — design notes',
                  current_version_id: 'ver-7',
                  updated_at: '2026-09-28T10:00:00.000Z'
                }
              ]
            }
          : {
              node_id: kb.nodeId,
              path: body.params?.arguments?.path,
              current_version_id: 'ver-7',
              body: NOTE
            };
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: JSON.stringify(payload) }] }
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' }
        }
      );
    }
    return fakeFetch(input, init);
  };
  const connections = createConnectionsRuntime({
    db,
    env: {
      KNOWLEDGEBASE_MCP_URL: KB_MCP_URL,
      ACCOUNT_CONNECTIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64')
    },
    publicBaseUrl: 'https://backend.test',
    webReturnOrigin: null,
    fetch: kbFetch,
    sourceCheckTtlMs: 0,
    checkers: chatSourceCheckers(db)
  });
  const started = await connections.connections.start(owner, {
    provider: 'knowledgebase',
    returnTo: 'mobile'
  });
  const outcome = await connections.connections.complete(
    kb.consent(started.authorizeUrl, 'kb-owner')
  );
  report.knowledgebaseConnection = outcome;
  report.knowledgebaseTools = (await connections.knowledgebase!.tools(owner)).map(t => t.id);

  const gateway = new ChatToolGateway({
    db,
    knowledgebase: connections.knowledgebase!,
    readRepository: ({ ctx: c, request, scopeKey, signal }) =>
      performRepositoryRead({
        ctx: c,
        request,
        scopeKey,
        signal,
        queueOptions: { pollIntervalMs: 20 }
      })
  });
  const options = { checkSource: connections.checkSource, limits: { attemptLeaseMs: 4000 } };
  const c = new Conversations(db, options);
  const requests: GeminiRequest[] = [];
  const client = recording(sdkGeminiClient(env()), requests);
  const runtime = new GeminiChatRuntime({ client, gateway, summaryEveryMessages: 2 });

  // 1. Research: Knowledgebase plus current repository state on both checkouts.
  const worker = new ChatWorker(() => new ChatRuns(db, options), runtime, 2);
  worker.start();
  const t0 = Date.now();
  const thread = await c.create(owner, {
    clientRequestId: randomUUID(),
    text: 'What would adding offline support require across Overlord and OverlordMobile? Check our notes and what is currently being changed in both repositories (git status and the relevant code), and cite your evidence.'
  });
  const snap1 = await waitTerminal(c, owner, thread.thread.id);
  const answer = snap1.messages.filter(m => m.role === 'assistant').at(-1);
  const tools = await db.all<{
    tool_id: string;
    state: string;
    executions: number;
    turn_index: number;
    result_json: string;
  }>(
    'SELECT tool_id, state, executions, turn_index, result_json FROM chat_tool_calls ORDER BY turn_index, call_order'
  );
  report.research = {
    latencyMs: Date.now() - t0,
    run: snap1.latestRun ?? snap1.activeRun,
    toolCalls: tools.map(t => ({
      tool: t.tool_id,
      turn: t.turn_index,
      state: t.state,
      executions: t.executions,
      outcome: JSON.parse(t.result_json ?? '{}').outcome
    })),
    providerRequests: shape(requests),
    declaredTools: requests[0]?.config.tools?.[0]?.functionDeclarations.map(d => d.name),
    runnerExecuted: [...runner.executed],
    answer: answer?.blocks.find(b => b.kind === 'text'),
    evidence: answer?.blocks.find(b => b.kind === 'evidence'),
    summaryWritten: Boolean(await db.get('SELECT id FROM chat_thread_summaries'))
  };
  console.log(JSON.stringify(report.research, null, 2));
  await worker.stop();

  // 2. Restart: a worker dies right after a tool result is joined; another resumes live.
  requests.length = 0;
  const thread2 = await c.create(owner, {
    clientRequestId: randomUUID(),
    text: 'In parallel, read the git status of both the Overlord and OverlordMobile primary resources, then tell me which one has more modified files.'
  });
  class Crash extends Error {}
  const dying = new ChatRuns(db, options);
  const crashing = new Proxy(dying, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'joinTools' || typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        await value.apply(target, args);
        throw new Crash();
      };
    }
  });
  const a1 = await dying.claim('dying-worker', runtime.identity);
  let firstExit = 'returned';
  await runtime.execute(a1!, crashing, new AbortController().signal).catch(e => {
    firstExit = e instanceof Crash ? 'crashed_after_join' : `error:${String(e?.message ?? e)}`;
  });
  const afterCrash = await db.get<{ phase: string }>(
    'SELECT phase FROM chat_provider_checkpoints WHERE run_id = ?',
    [a1!.runId]
  );
  await new Promise(r => setTimeout(r, 4500)); // lease expiry
  const worker2 = new ChatWorker(() => new ChatRuns(db, options), runtime, 2);
  worker2.start();
  const snap2 = await waitTerminal(c, owner, thread2.thread.id);
  await worker2.stop();
  const attempts = await db.all<{ attempt_number: number; recovery_mode: string; state: string }>(
    'SELECT attempt_number, recovery_mode, state FROM chat_run_attempts WHERE run_id = ? ORDER BY attempt_number',
    [a1!.runId]
  );
  const calls2 = await db.all<{ tool_id: string; executions: number; state: string }>(
    'SELECT tool_id, executions, state FROM chat_tool_calls WHERE run_id = ? ORDER BY turn_index, call_order',
    [a1!.runId]
  );
  report.restart = {
    firstExit,
    checkpointPhaseAfterCrash: afterCrash?.phase ?? null,
    attempts,
    toolCalls: calls2,
    finalRun: snap2.latestRun,
    providerRequests: shape(requests),
    answer: snap2.messages
      .filter(m => m.role === 'assistant')
      .at(-1)
      ?.blocks.find(b => b.kind === 'text')
  };
  console.log(JSON.stringify(report.restart, null, 2));

  // 3. Revocation: the note becomes inaccessible upstream; derived content is withheld and
  // a follow-up never sends it to the provider.
  kb.revokedNodes.add(`kb-owner:${kb.nodeId}`);
  const snap3 = await c.snapshot(owner, thread.thread.id);
  requests.length = 0;
  const worker3 = new ChatWorker(() => new ChatRuns(db, options), runtime, 2);
  worker3.start();
  await c.submit(owner, thread.thread.id, {
    clientRequestId: randomUUID(),
    text: 'Summarize again what our notes said about capture.'
  });
  const snap4 = await waitTerminal(c, owner, thread.thread.id);
  await worker3.stop();
  const sent = JSON.stringify(requests.map(r => r.contents));
  report.revocation = {
    unavailableBlocksAfterRevocation: snap3.messages.filter(
      m => m.blocks[0]?.kind === 'unavailable'
    ).length,
    noteTextInSnapshot: JSON.stringify(snap3).includes('OfflineObjectiveStore only queues'),
    noteTextSentToProviderAfterRevocation: sent.includes('OfflineObjectiveStore only queues'),
    withheldMarkerSent: sent.includes('withheld: source access was lost'),
    followUpRun: snap4.latestRun,
    followUpAnswer: snap4.messages
      .filter(m => m.role === 'assistant')
      .at(-1)
      ?.blocks.find(b => b.kind === 'text')
  };
  console.log(JSON.stringify(report.revocation, null, 2));

  runner.stop();
  report.finishedAt = new Date().toISOString();
  const out = path.join(import.meta.dirname, 'results');
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, `live-research-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify(report, null, 2)
  );
  process.exit(0);
}

void main().catch(error => {
  console.error('live proof failed:', error?.message ?? error);
  process.exit(1);
});
