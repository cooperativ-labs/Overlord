import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import { ServiceError } from './errors.js';
import { claimNextExecutionRequest } from './execution-requests.js';
import {
  readRunnerLiveness,
  recordRunnerHeartbeat,
  resolveRunnerTarget,
  RUNNER_HEARTBEAT_STALE_MS
} from './execution-target-runners.js';
import { ensureCallerDeviceTarget, NO_EXECUTION_TARGET_REGISTERED } from './execution-targets.js';
import { createMissionWithObjectives } from './missions.js';
import { listEligibleProjectExecutionTargets } from './project-execution-target.js';
import { addProjectResource, createProject } from './projects.js';
import { createSeededServiceContext } from './test-helpers.js';
import { newId, nowIso } from './util.js';

/**
 * Contract v40: a runner instance is a separate, one-to-many record hanging off
 * an execution target the user already declared. These tests pin the four things
 * that makes possible — authorized adoption, several runners on one target,
 * claim attribution, and reachability that reflects a runner rather than any CLI
 * traffic from the machine — plus the compatibility rollout that gets us there.
 */

async function countTargets(db: DatabaseClient): Promise<number> {
  const row = (await db.get(
    `SELECT COUNT(*) AS c FROM execution_targets WHERE deleted_at IS NULL`
  )) as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

async function countRunners(db: DatabaseClient): Promise<number> {
  const row = (await db.get(
    `SELECT COUNT(*) AS c FROM execution_target_runner_registrations WHERE deleted_at IS NULL`
  )) as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

/**
 * A hosted (non-co-located) backend view over the same SQLite database, standing
 * in for a container: it carries a machine hint that is not the declared host's,
 * so nothing about it resolves the host target implicitly.
 */
function asPodCtx(ctx: ServiceContext): ServiceContext {
  return {
    ...ctx,
    db: new Proxy(ctx.db, {
      get(inner, prop, receiver) {
        if (prop === 'dialect') return 'postgres';
        const value = Reflect.get(inner, prop, receiver) as unknown;
        // The adapter uses private fields, so methods must stay bound to the
        // real client rather than being invoked with the proxy as `this`.
        return typeof value === 'function' ? value.bind(inner) : value;
      }
    }) as DatabaseClient,
    clientDevice: {
      deviceFingerprint: 'agent-pod-container-abc123',
      deviceLabel: 'agent-pod',
      devicePlatform: 'linux'
    }
  };
}

/** A project with a linked checkout on the acting machine, plus a queued request. */
async function seedQueuedRequest(ctx: ServiceContext, name: string): Promise<string> {
  const project = await createProject({ ctx, name });
  await addProjectResource({
    ctx,
    projectId: project.id,
    directoryPath: mkdtempSync(path.join(tmpdir(), 'ovld-runner-target-')),
    isPrimary: true
  });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Work for whichever runner claims it' }]
  });
  const requestId = newId();
  const now = nowIso();
  await ctx.db.run(
    `INSERT INTO execution_requests
       (id, workspace_id, project_id, mission_id, objective_id, requested_agent,
        launch_mode, launch_flags_json, target_kind, requested_source, status,
        created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, 'codex', 'run', '{}', 'local', 'cli', 'queued', ?, ?, 1)`,
    [requestId, ctx.workspace.id, project.id, mission.id, objectives[0]?.id, now, now]
  );
  return requestId;
}

describe('local runner instances and adoption (contract v40)', () => {
  it('refuses an explicit target that does not exist, and creates nothing', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const before = await countTargets(db);

    await assert.rejects(
      () => resolveRunnerTarget({ ctx, input: { executionTargetId: newId() } }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === NO_EXECUTION_TARGET_REGISTERED &&
        error.status === 409 &&
        /ovld add-et/.test(error.message)
    );

    assert.equal(await countTargets(db), before);
    assert.equal(await countRunners(db), 0);
    await db.close();
  });

  it('refuses a disabled target and a target the caller has no access to', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const target = await ensureCallerDeviceTarget({ ctx });

    await db.run(`UPDATE execution_targets SET status = 'disabled' WHERE id = ?`, [
      target.executionTargetId
    ]);
    await assert.rejects(
      () => resolveRunnerTarget({ ctx, input: { executionTargetId: target.executionTargetId } }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === NO_EXECUTION_TARGET_REGISTERED &&
        /disabled/.test(error.message)
    );

    await db.run(`UPDATE execution_targets SET status = 'active' WHERE id = ?`, [
      target.executionTargetId
    ]);
    await db.run(
      `UPDATE workspace_user_execution_targets SET access_status = 'disabled'
        WHERE execution_target_id = ?`,
      [target.executionTargetId]
    );
    await assert.rejects(
      () => resolveRunnerTarget({ ctx, input: { executionTargetId: target.executionTargetId } }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === NO_EXECUTION_TARGET_REGISTERED &&
        /do not have access/.test(error.message)
    );

    assert.equal(await countRunners(db), 0);
    await db.close();
  });

  it('refuses a native runner on a disabled target, so disabling stops claims', async () => {
    // Contract v41 promises that disabling a target both removes it from
    // eligibility and makes runners reject claims for it. The explicit-target
    // path enforces that (above); the acting-machine path must agree, or an
    // administrator disabling a target would still see its own runner drain the
    // queue while an adopting pod pointed at the same row is refused.
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const requestId = await seedQueuedRequest(ctx, 'Disabled target');
    const host = await resolveRunnerTarget({ ctx, input: {} });

    await db.run(`UPDATE execution_targets SET status = 'disabled' WHERE id = ?`, [
      host.executionTargetId
    ]);

    await assert.rejects(
      () => resolveRunnerTarget({ ctx, input: { runnerInstanceId: 'host-runner' } }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === NO_EXECUTION_TARGET_REGISTERED &&
        /disabled/.test(error.message)
    );
    await assert.rejects(
      () => claimNextExecutionRequest({ ctx, runner: { runnerInstanceId: 'host-runner' } }),
      (error: unknown) =>
        error instanceof ServiceError && error.code === NO_EXECUTION_TARGET_REGISTERED
    );

    const row = (await db.get(`SELECT status FROM execution_requests WHERE id = ?`, [
      requestId
    ])) as { status: string };
    assert.equal(row.status, 'queued', 'queued work survives to be claimed after re-enabling');
    assert.equal(await countRunners(db), 0, 'a refused claim registers no runner instance');

    // Re-enabling restores the runner without any re-declaration.
    await db.run(`UPDATE execution_targets SET status = 'active' WHERE id = ?`, [
      host.executionTargetId
    ]);
    const claimed = await claimNextExecutionRequest({
      ctx,
      runner: { runnerInstanceId: 'host-runner' }
    });
    assert.equal(claimed?.id, requestId);

    await db.close();
  });

  it('lets a container adopt its host target without creating a second target', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const host = await ensureCallerDeviceTarget({ ctx });
    const targetsAfterDeclaration = await countTargets(db);

    const pod = asPodCtx(ctx);
    const resolved = await resolveRunnerTarget({
      ctx: pod,
      input: { executionTargetId: host.executionTargetId, runnerInstanceId: 'pod-1' }
    });

    assert.equal(resolved.executionTargetId, host.executionTargetId);
    assert.equal(resolved.deviceId, host.deviceId);
    assert.equal(resolved.relation, 'adopted', 'a foreign machine serving a target is adopting it');
    assert.equal(
      await countTargets(db),
      targetsAfterDeclaration,
      'adoption shares the host row rather than declaring one'
    );
    await db.close();
  });

  it('resolves the acting machine natively and refuses a machine nobody declared', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });

    await assert.rejects(
      () => resolveRunnerTarget({ ctx, input: { runnerInstanceId: 'undeclared' } }),
      (error: unknown) =>
        error instanceof ServiceError && error.code === NO_EXECUTION_TARGET_REGISTERED
    );

    const host = await ensureCallerDeviceTarget({ ctx });
    const resolved = await resolveRunnerTarget({ ctx, input: { runnerInstanceId: 'host-1' } });
    assert.equal(resolved.executionTargetId, host.executionTargetId);
    assert.equal(resolved.relation, 'native');

    // An explicit id naming this machine's own target stays native.
    const explicit = await resolveRunnerTarget({
      ctx,
      input: { executionTargetId: host.executionTargetId }
    });
    assert.equal(explicit.relation, 'native');

    await db.close();
  });

  it('records several runner instances against one target', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const host = await ensureCallerDeviceTarget({ ctx });

    await recordRunnerHeartbeat({
      ctx,
      executionTargetId: host.executionTargetId,
      runnerInstanceId: 'host-runner',
      relation: 'native',
      label: 'jake-mbp',
      runnerVersion: '1.2.3'
    });
    await recordRunnerHeartbeat({
      ctx,
      executionTargetId: host.executionTargetId,
      runnerInstanceId: 'pod-runner',
      relation: 'adopted',
      label: 'agent-pod'
    });
    // Re-registering the same instance is an upsert, not a second row.
    await recordRunnerHeartbeat({
      ctx,
      executionTargetId: host.executionTargetId,
      runnerInstanceId: 'host-runner',
      relation: 'native'
    });

    assert.equal(await countRunners(db), 2);
    assert.equal(await countTargets(db), 1);

    const liveness = await readRunnerLiveness({
      ctx,
      executionTargetIds: [host.executionTargetId]
    });
    const entry = liveness.get(host.executionTargetId);
    assert.ok(entry);
    assert.equal(entry.hasRegistration, true);
    assert.equal(entry.live, true);
    assert.equal(entry.nativeCount, 1);
    assert.equal(entry.adoptedCount, 1);

    await db.close();
  });

  it('attributes a claim to the winning runner instance, and to none without one', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const requestId = await seedQueuedRequest(ctx, 'Claim attribution');

    const claimed = await claimNextExecutionRequest({
      ctx,
      runner: { runnerInstanceId: 'host-runner', runnerVersion: '9.9.9' }
    });
    assert.ok(claimed);
    assert.equal(claimed.id, requestId);

    const row = (await db.get(
      `SELECT claimed_by_runner_registration_id AS reg, claimed_by_execution_target_id AS target
         FROM execution_requests WHERE id = ?`,
      [requestId]
    )) as { reg: string | null; target: string | null };
    const registration = (await db.get(
      `SELECT id, relation FROM execution_target_runner_registrations
        WHERE runner_instance_id = 'host-runner' AND deleted_at IS NULL`
    )) as { id: string; relation: string } | undefined;
    assert.ok(registration);
    assert.equal(row.reg, registration.id);
    assert.equal(row.target, (await resolveRunnerTarget({ ctx, input: {} })).executionTargetId);
    assert.equal(registration.relation, 'native');

    // An older runner publishes no instance identity: it still claims, and simply
    // attributes to no runner registration.
    const secondRequestId = await seedQueuedRequest(ctx, 'Claim without runner identity');
    const legacyClaim = await claimNextExecutionRequest({ ctx });
    assert.ok(legacyClaim);
    assert.equal(legacyClaim.id, secondRequestId);
    const legacyRow = (await db.get(
      `SELECT claimed_by_runner_registration_id AS reg FROM execution_requests WHERE id = ?`,
      [secondRequestId]
    )) as { reg: string | null };
    assert.equal(legacyRow.reg, null);
    assert.equal(await countRunners(db), 1);

    await db.close();
  });

  it('lets an adopting container claim the host target work', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const requestId = await seedQueuedRequest(ctx, 'Adopted claim');
    const host = await resolveRunnerTarget({ ctx, input: {} });

    const pod = asPodCtx(ctx);
    const claimed = await claimNextExecutionRequest({
      ctx: pod,
      runner: { executionTargetId: host.executionTargetId, runnerInstanceId: 'pod-runner' }
    });

    assert.ok(claimed);
    assert.equal(claimed.id, requestId);
    assert.equal(
      claimed.claimedByExecutionTargetId,
      host.executionTargetId,
      'the pod claims as the host target, not as a target of its own'
    );
    assert.equal(await countTargets(db), 1);

    const registration = (await db.get(
      `SELECT execution_target_id AS target, relation FROM execution_target_runner_registrations
        WHERE runner_instance_id = 'pod-runner' AND deleted_at IS NULL`
    )) as { target: string; relation: string } | undefined;
    assert.equal(registration?.target, host.executionTargetId);
    assert.equal(registration?.relation, 'adopted');

    await db.close();
  });
});

describe('local reachability follows runners, with a compatible rollout (contract v40)', () => {
  async function eligibleReachable(ctx: ServiceContext, projectId: string): Promise<boolean> {
    const targets = await listEligibleProjectExecutionTargets({ ctx, projectId });
    assert.equal(targets.length, 1);
    return targets[0]!.reachable;
  }

  it('honors device traffic until the first runner heartbeat, then only runners', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Reachability rollout' });
    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: mkdtempSync(path.join(tmpdir(), 'ovld-reachability-')),
      isPrimary: true
    });
    const host = await resolveRunnerTarget({ ctx, input: {} });

    // Rollout window: no runner has registered yet, so the pre-v40 device
    // liveness still decides and an existing install stays selectable.
    await db.run(`UPDATE devices SET last_seen_at = ?`, [nowIso()]);
    assert.equal(await eligibleReachable(ctx, project.id), true);

    // Once a runner registers, device traffic no longer counts: a stale runner
    // heartbeat means offline even with fresh CLI traffic from the machine.
    await recordRunnerHeartbeat({
      ctx,
      executionTargetId: host.executionTargetId,
      runnerInstanceId: 'host-runner',
      relation: 'native'
    });
    await db.run(`UPDATE devices SET last_seen_at = ?`, [nowIso()]);
    await db.run(
      `UPDATE execution_target_runner_registrations SET last_heartbeat_at = ? WHERE runner_instance_id = 'host-runner'`,
      [new Date(Date.now() - RUNNER_HEARTBEAT_STALE_MS - 1000).toISOString()]
    );
    assert.equal(
      await eligibleReachable(ctx, project.id),
      false,
      'a machine whose runner stopped is offline however much other CLI traffic it makes'
    );

    // A fresh heartbeat brings it back.
    await recordRunnerHeartbeat({
      ctx,
      executionTargetId: host.executionTargetId,
      runnerInstanceId: 'host-runner',
      relation: 'native'
    });
    assert.equal(await eligibleReachable(ctx, project.id), true);

    // An unhealthy runner is not a live one.
    await db.run(
      `UPDATE execution_target_runner_registrations SET health = 'unreachable' WHERE runner_instance_id = 'host-runner'`
    );
    assert.equal(await eligibleReachable(ctx, project.id), false);

    // …but any other healthy runner on the same target — an adopting pod — is.
    await recordRunnerHeartbeat({
      ctx,
      executionTargetId: host.executionTargetId,
      runnerInstanceId: 'pod-runner',
      relation: 'adopted'
    });
    assert.equal(await eligibleReachable(ctx, project.id), true);

    await db.close();
  });
});
