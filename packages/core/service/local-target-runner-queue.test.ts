import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDefaultLocalTargetRegistry } from './local-target/default-registry.js';
import { FakeLocalTargetProvider } from './local-target/fake-provider.js';
import { UnavailableProvider } from './local-target/registry.js';
import { RunnerQueueProvider } from './local-target/runner-queue-provider.js';
import type { TargetMetadata } from './local-target/types.js';
import type { ServiceContext } from './context.js';
import { claimNextExecutionRequest } from './execution-requests.js';
import { resolveRunnerTarget } from './execution-target-runners.js';
import { executeLocalTargetMutation } from './local-target-mutation-runner.js';
import {
  completeLocalTargetMutationRequest,
  parseLocalTargetMutation
} from './local-target-mutations.js';
import { createMissionWithObjectives } from './missions.js';
import { addProjectResource, createProject } from './projects.js';
import { createIsolatedCheckout } from './test-checkout.ts';
import { createSeededServiceContext } from './test-helpers.js';
import { newId, nowIso } from './util.js';

/**
 * Phase B (coo:833) turns `RunnerQueueProvider` from a stub that failed every
 * capability into the transport for *every* capability on a device the backend
 * is not. These tests pin the round trip end to end — queue, generic dispatch,
 * stored envelope, awaited result — plus the three things that make it safe to
 * generalize: an unknown capability fails closed, a caller's deadline is
 * "still running" rather than "failed", and a call with no mission is a valid
 * queue row rather than one anchored to an unrelated mission.
 */

async function setupProject(ctx: ServiceContext, name: string) {
  const project = await createProject({ ctx, name });
  await addProjectResource({
    ctx,
    projectId: project.id,
    directoryPath: createIsolatedCheckout('ovld-runner-queue-'),
    isPrimary: true
  });
  const { mission } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Anchor for queued capability calls' }]
  });
  const target = await resolveRunnerTarget({ ctx, input: {} });
  return { projectId: project.id, missionId: mission.id, target };
}

function remoteTargetMetadata(executionTargetId: string): TargetMetadata {
  return { executionTargetId, deviceLabel: 'CI VM', transport: 'runner_queue' };
}

/**
 * Stand in for `ovld runner`: take the oldest queued capability call, move it to
 * `claimed` the way the claim does, run it through the same generic dispatcher
 * the CLI uses, and post the envelope back. Retries briefly because the caller
 * queues and waits in one call, so the row may not exist the instant we look.
 */
async function drainOneQueuedCapability(
  ctx: ServiceContext,
  provider: FakeLocalTargetProvider
): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const row = (await ctx.db.get(
      `SELECT id, metadata_json, revision FROM execution_requests
        WHERE workspace_id = ? AND requested_source = 'local_target_mutation'
          AND status = 'queued' AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT 1`,
      [ctx.workspace.id]
    )) as { id: string; metadata_json: string; revision: number } | undefined;
    if (row) {
      const mutation = parseLocalTargetMutation(row.metadata_json);
      assert.ok(mutation, 'queued row carries parseable mutation metadata');
      await ctx.db.run(
        `UPDATE execution_requests SET status = 'claimed', revision = ? WHERE id = ?`,
        [row.revision + 1, row.id]
      );
      const result = await executeLocalTargetMutation({ mutation, provider });
      await completeLocalTargetMutationRequest({ ctx, requestId: row.id, result });
      return row.id;
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('No queued local-target capability call appeared.');
}

function providerFor({
  ctx,
  projectId,
  missionId,
  executionTargetId,
  writeTimeoutMs = 5_000
}: {
  ctx: ServiceContext;
  projectId: string;
  missionId?: string | null;
  executionTargetId: string;
  writeTimeoutMs?: number;
}): RunnerQueueProvider {
  return new RunnerQueueProvider(remoteTargetMetadata(executionTargetId), {
    ctx,
    projectId,
    missionId: missionId ?? null,
    readTimeoutMs: writeTimeoutMs,
    writeTimeoutMs,
    pollIntervalMs: 5
  });
}

describe('RunnerQueueProvider round trip', () => {
  it('carries a read capability to the target and returns its envelope', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const { projectId, missionId, target } = await setupProject(ctx, 'Queued read');
    const provider = providerFor({
      ctx,
      projectId,
      missionId,
      executionTargetId: target.executionTargetId
    });
    const fake = new FakeLocalTargetProvider();

    const pending = provider.listBranches({ resourceId: 'r1', repoPath: '/repo' });
    await drainOneQueuedCapability(ctx, fake);
    const result = await pending;

    assert.ok(result.ok, 'the queued read resolves through the runner');
    assert.deepEqual(result.value.local, ['main']);
    assert.equal(result.target.transport, 'runner_queue');
    assert.equal(result.target.executionTargetId, target.executionTargetId);
    assert.deepEqual(fake.calls[0]?.capability, 'listBranches');
    await db.close();
  });

  it('carries sendLatchMessage and records the answer application state', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const { projectId, missionId, target } = await setupProject(ctx, 'Queued answer');
    const now = nowIso();
    const channelId = newId();
    await db.run(
      `INSERT INTO agent_session_channels
         (id, workspace_id, project_id, mission_id, launch_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'unknown', ?, ?)`,
      [channelId, ctx.workspace.id, projectId, missionId, now, now]
    );
    const agentRequestId = newId();
    await db.run(
      `INSERT INTO agent_requests
         (id, workspace_id, project_id, mission_id, channel_id, kind, summary,
          application_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'question', 'Which branch?', 'emitted', ?, ?)`,
      [agentRequestId, ctx.workspace.id, projectId, missionId, channelId, now, now]
    );

    const provider = providerFor({
      ctx,
      projectId,
      missionId,
      executionTargetId: target.executionTargetId
    });
    const fake = new FakeLocalTargetProvider();

    // The answer's `operationId` is the agent_requests row id: one value that is
    // both Latch's idempotency key and the row the completion hook records against.
    const pending = provider.sendLatchMessage({
      providerSessionId: 'latch-session-1',
      operationId: agentRequestId,
      text: 'Use main.'
    });
    await drainOneQueuedCapability(ctx, fake);
    const result = await pending;

    assert.ok(result.ok);
    assert.equal(result.value.status, 'accepted');
    const applied = (await db.get(`SELECT application_state FROM agent_requests WHERE id = ?`, [
      agentRequestId
    ])) as { application_state: string };
    assert.equal(applied.application_state, 'applied');
    await db.close();
  });

  it('maps a refused delivery to not_applied without failing the call', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const { projectId, missionId, target } = await setupProject(ctx, 'Refused answer');
    const now = nowIso();
    const channelId = newId();
    await db.run(
      `INSERT INTO agent_session_channels
         (id, workspace_id, project_id, mission_id, launch_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'unknown', ?, ?)`,
      [channelId, ctx.workspace.id, projectId, missionId, now, now]
    );
    const agentRequestId = newId();
    await db.run(
      `INSERT INTO agent_requests
         (id, workspace_id, project_id, mission_id, channel_id, kind, summary,
          application_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'question', 'Which branch?', 'emitted', ?, ?)`,
      [agentRequestId, ctx.workspace.id, projectId, missionId, channelId, now, now]
    );

    const provider = providerFor({
      ctx,
      projectId,
      missionId,
      executionTargetId: target.executionTargetId
    });
    const fake = new FakeLocalTargetProvider({
      handlers: {
        sendLatchMessage: async input => ({
          ok: true,
          value: {
            providerSessionId: input.providerSessionId,
            operationId: input.operationId,
            status: 'refused' as const,
            reason: 'session_exited',
            deliveredAt: nowIso()
          },
          target: { executionTargetId: 'fake', deviceLabel: null, transport: 'fake' as const }
        })
      }
    });

    const pending = provider.sendLatchMessage({
      providerSessionId: 'latch-session-2',
      operationId: agentRequestId,
      text: 'Use main.'
    });
    await drainOneQueuedCapability(ctx, fake);
    const result = await pending;

    assert.ok(result.ok);
    assert.equal(result.value.status, 'refused');
    const applied = (await db.get(`SELECT application_state FROM agent_requests WHERE id = ?`, [
      agentRequestId
    ])) as { application_state: string };
    assert.equal(applied.application_state, 'not_applied');
    await db.close();
  });

  it('returns a typed failure envelope rather than a bare failure', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const { projectId, missionId, target } = await setupProject(ctx, 'Failing capability');
    const provider = providerFor({
      ctx,
      projectId,
      missionId,
      executionTargetId: target.executionTargetId
    });
    const fake = new FakeLocalTargetProvider({
      handlers: {
        listBranches: async () => ({
          ok: false,
          code: 'NOT_GIT_REPOSITORY' as const,
          message: 'Not a git repository.',
          target: { executionTargetId: 'fake', deviceLabel: null, transport: 'fake' as const }
        })
      }
    });

    const pending = provider.listBranches({ resourceId: 'r1', repoPath: '/repo' });
    await drainOneQueuedCapability(ctx, fake);
    const result = await pending;

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'NOT_GIT_REPOSITORY');
    assert.equal(result.ok === false && result.message, 'Not a git repository.');
    await db.close();
  });

  it('reports LOCAL_TARGET_TIMEOUT, with the request id, when nothing claims the job', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const { projectId, missionId, target } = await setupProject(ctx, 'Nobody claims');
    const provider = providerFor({
      ctx,
      projectId,
      missionId,
      executionTargetId: target.executionTargetId,
      writeTimeoutMs: 60
    });

    const result = await provider.doctor();
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'LOCAL_TARGET_TIMEOUT');
    const details = result.ok === false ? (result.details as { executionRequestId?: string }) : {};
    assert.ok(details.executionRequestId, 'the caller can point at the still-running job');
    // The job outlives the wait: a timeout must never clear or fail the row.
    const row = (await db.get(`SELECT status FROM execution_requests WHERE id = ?`, [
      details.executionRequestId
    ])) as { status: string };
    assert.equal(row.status, 'queued');
    await db.close();
  });

  it('declines launchAgent instead of racing the dedicated launch path', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const { projectId, missionId, target } = await setupProject(ctx, 'No queued launch');
    const provider = providerFor({
      ctx,
      projectId,
      missionId,
      executionTargetId: target.executionTargetId
    });

    const result = await provider.launchAgent({ executionRequestId: newId() });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'LOCAL_TARGET_UNSUPPORTED');
    const queued = (await db.get(
      `SELECT COUNT(*) AS c FROM execution_requests WHERE requested_source = 'local_target_mutation'`
    )) as { c: number };
    assert.equal(Number(queued.c), 0, 'nothing is queued for a launch');
    await db.close();
  });

  it('reuses a queued job when the caller repeats an operationId', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const { projectId, missionId, target } = await setupProject(ctx, 'Idempotent answer');
    const provider = providerFor({
      ctx,
      projectId,
      missionId,
      executionTargetId: target.executionTargetId,
      writeTimeoutMs: 60
    });
    const operationId = newId();

    await provider.sendLatchMessage({ providerSessionId: 's1', operationId, text: 'one' });
    await provider.sendLatchMessage({ providerSessionId: 's1', operationId, text: 'one' });

    const queued = (await db.get(
      `SELECT COUNT(*) AS c FROM execution_requests
        WHERE requested_source = 'local_target_mutation' AND idempotency_key = ?`,
      [operationId]
    )) as { c: number };
    assert.equal(Number(queued.c), 1, 'a repeated answer is delivered once');
    await db.close();
  });
});

describe('mission-less capability calls', () => {
  it('queues with no mission or objective and records no mission event', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const { projectId, target } = await setupProject(ctx, 'Mission-less probe');
    const provider = providerFor({
      ctx,
      projectId,
      missionId: null,
      executionTargetId: target.executionTargetId
    });
    const fake = new FakeLocalTargetProvider();

    const pending = provider.discoverLatch({ force: true });
    const requestId = await drainOneQueuedCapability(ctx, fake);
    const result = await pending;

    assert.ok(result.ok);
    assert.equal(result.value.state, 'not_installed');
    const row = (await db.get(
      `SELECT mission_id, objective_id, project_id FROM execution_requests WHERE id = ?`,
      [requestId]
    )) as { mission_id: string | null; objective_id: string | null; project_id: string };
    assert.equal(row.mission_id, null);
    assert.equal(row.objective_id, null);
    assert.equal(row.project_id, projectId, 'authorization is project + target scoped');
    const events = (await db.get(
      `SELECT COUNT(*) AS c FROM mission_events
        WHERE json_extract(payload_json, '$.executionRequestId') = ?`,
      [requestId]
    )) as { c: number };
    assert.equal(Number(events.c), 0, 'no mission means no mission timeline entry');
    await db.close();
  });

  it('rejects a mission-less row for any other requested_source', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const { projectId } = await setupProject(ctx, 'Guarded source');
    const now = nowIso();
    await assert.rejects(() =>
      db.run(
        `INSERT INTO execution_requests
           (id, workspace_id, project_id, mission_id, objective_id, launch_mode,
            launch_flags_json, requested_source, status, metadata_json, created_at, updated_at, revision)
         VALUES (?, ?, ?, NULL, NULL, 'run', '{}', 'cli', 'queued', '{}', ?, ?, 1)`,
        [newId(), ctx.workspace.id, projectId, now, now]
      )
    );
    await db.close();
  });

  it('is claimable: the claim no longer requires a joined objective', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { projectId, target } = await setupProject(ctx, 'Claimable probe');
    const provider = providerFor({
      ctx,
      projectId,
      missionId: null,
      executionTargetId: target.executionTargetId,
      writeTimeoutMs: 60
    });

    // Times out on purpose: we only want the row queued, then claimed for real.
    await provider.doctor();
    const claimed = await claimNextExecutionRequest({ ctx, projectId });
    assert.ok(claimed, 'a mission-less capability call is claimable');
    assert.equal(claimed?.missionId, null);
    assert.equal(claimed?.objectiveId, null);
    assert.equal(claimed?.requestedSource, 'local_target_mutation');
    await db.close();
  });
});

describe('generic capability dispatch', () => {
  it('fails closed on a capability the runner does not execute', async () => {
    const fake = new FakeLocalTargetProvider();
    const result = await executeLocalTargetMutation({
      mutation: {
        kind: 'capability_call',
        // Deliberately outside the vocabulary: a hand-built payload must not be
        // able to invoke an arbitrary property of the provider.
        capability: 'toString' as never,
        input: {}
      },
      provider: fake
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'LOCAL_TARGET_UNSUPPORTED');
    assert.equal(fake.calls.length, 0);
  });

  it('refuses to parse a launchAgent or unknown capability off the queue', () => {
    assert.equal(
      parseLocalTargetMutation({
        'overlord.localTargetMutation': {
          kind: 'capability_call',
          capability: 'launchAgent',
          input: {}
        }
      }),
      null
    );
    assert.equal(
      parseLocalTargetMutation({
        'overlord.localTargetMutation': {
          kind: 'capability_call',
          capability: 'notACapability',
          input: {}
        }
      }),
      null
    );
  });

  it('dispatches every queueable capability by name', async () => {
    const fake = new FakeLocalTargetProvider();
    const result = await executeLocalTargetMutation({
      mutation: { kind: 'capability_call', capability: 'doctor', input: {} },
      provider: fake
    });
    assert.ok(result.ok);
    assert.equal(fake.calls[0]?.capability, 'doctor');
  });
});

describe('default registry', () => {
  it('resolves a remote reachable target to a working runner-queue provider', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
    const { projectId, missionId } = await setupProject(ctx, 'Registry resolution');
    const registry = createDefaultLocalTargetRegistry({
      callerExecutionTargetId: 'laptop-1',
      runnerQueue: { ctx, projectId, missionId, pollIntervalMs: 5 }
    });
    const provider = registry.resolveOrUnavailable({
      executionTargetId: 'vm-1',
      type: 'local',
      reachable: true
    });
    assert.ok(provider instanceof RunnerQueueProvider);
    assert.equal(provider.target.transport, 'runner_queue');
    await db.close();
  });

  it('reports the queue as unreachable when the caller cannot write to it', async () => {
    const registry = createDefaultLocalTargetRegistry({ callerExecutionTargetId: 'laptop-1' });
    const provider = registry.resolveOrUnavailable({
      executionTargetId: 'vm-1',
      type: 'local',
      reachable: true
    });
    assert.ok(provider instanceof UnavailableProvider);
    const result = await provider.doctor();
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'LOCAL_TARGET_UNREACHABLE');
  });
});
