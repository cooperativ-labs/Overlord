import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { claimNextExecutionRequest } from '../packages/core/service/execution-requests.ts';
import { recordRunnerHeartbeat } from '../packages/core/service/execution-target-runners.ts';
import { latchHostKeyDigest } from '../packages/core/service/latch-host-identity.ts';
import {
  FakeLocalTargetProvider,
  ok,
  RunnerQueueProvider
} from '../packages/core/service/local-target/index.ts';
import { executeLocalTargetMutation } from '../packages/core/service/local-target-mutation-runner.ts';
import {
  completeLocalTargetMutationRequest,
  parseLocalTargetMutation
} from '../packages/core/service/local-target-mutations.ts';

import { listenForTest } from './http/test-app-fixture.ts';
import { createIntegrationTestDb, seedAuthenticatedOperator } from './test-helpers.ts';

const harness = await createIntegrationTestDb('overlord-latch-host-');
const { db, tempDir } = harness;
const dbModule = await import('./db.ts');
const { updateProjectResourceLatchHost } =
  await import('./execution/project-resource-latch-host.ts');
const {
  createProject,
  createProjectResource,
  createUserToken,
  deleteProjectResourceSource,
  listProjectResources,
  updateProjectResourceSource
} = await import('./repository.ts');

const HOST_A = '01'.repeat(32);
const HOST_B = '02'.repeat(32);
const ctx = dbModule.buildWebappServiceContext();
const runner = { runnerInstanceId: 'native-latch-host-fixture' };
const otherActor = seedAuthenticatedOperator({
  db,
  profileId: 'other-latch-account',
  workspaceUserId: 'other-latch-member'
});

function shareTarget(targetId: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspace_user_execution_targets
       (id, workspace_id, workspace_user_id, execution_target_id, access_status, created_at, updated_at)
     SELECT ?, workspace_id, ?, execution_target_id, 'active', created_at, updated_at
       FROM workspace_user_execution_targets WHERE execution_target_id = ?`
  ).run(`shared-latch-${targetId}`, otherActor, targetId);
}

test.after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function secondTarget() {
  const id = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const stamp = new Date().toISOString();
  db.prepare(
    "INSERT INTO devices (id, workspace_id, fingerprint, label, platform, status, created_at, updated_at) VALUES (?, ?, ?, 'Same Mac', 'darwin', 'active', ?, ?)"
  ).run(deviceId, ctx.workspace.id, id, stamp, stamp);
  db.prepare(
    "INSERT INTO execution_targets (id, workspace_id, device_id, owner_workspace_user_id, type, label, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'local', 'Same Mac', 'active', ?, ?)"
  ).run(id, ctx.workspace.id, deviceId, ctx.actorWorkspaceUserId, stamp, stamp);
  db.prepare(
    "INSERT INTO workspace_user_execution_targets (id, workspace_id, workspace_user_id, execution_target_id, access_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)"
  ).run(crypto.randomUUID(), ctx.workspace.id, ctx.actorWorkspaceUserId, id, stamp, stamp);
  return id;
}

test('same path on two targets binds only the verified host; changes, ambiguity and removal hide stale bindings', async t => {
  const project = await createProject({ name: 'Same path on distinct Latch hosts' });
  const a = await createProjectResource(project.id, {
    resourceKey: 'repo',
    directoryPath: tempDir
  });
  const targetA = a.sources[0]!.executionTargetId!;
  const targetB = await secondTarget();
  const b = await createProjectResource(project.id, {
    resourceKey: 'repo',
    directoryPath: tempDir,
    executionTargetId: targetB
  });
  await recordRunnerHeartbeat({ ctx, executionTargetId: targetA, ...runner, relation: 'native' });
  await recordRunnerHeartbeat({
    ctx,
    executionTargetId: targetB,
    runnerInstanceId: 'other-mac',
    relation: 'native'
  });

  const aId = a.sources[0]!.id;
  const bId = b.sources.find(source => source.executionTargetId === targetB)!.id;
  const hosts = new Map([
    [targetA, HOST_A],
    [targetB, HOST_B]
  ]);
  const probe = t.mock.method(
    RunnerQueueProvider.prototype,
    'readLatchHostIdentity',
    async function (this: RunnerQueueProvider) {
      return ok(this.target, {
        hostKeyDigest: latchHostKeyDigest(hosts.get(this.target.executionTargetId!)!)
      });
    }
  );
  const sources = async () => (await listProjectResources(project.id))[0]!.sources;
  const link = async (id: string) =>
    (await sources()).find(source => source.id === id)?.latchHostLink;
  const update = async (sourceId: string, hostPublicKey: string | null, sourceRevision?: number) =>
    updateProjectResourceLatchHost({
      projectId: project.id,
      resourceId: a.id,
      sourceId,
      body: {
        sourceRevision: sourceRevision ?? (await link(sourceId))!.sourceRevision,
        hostPublicKey
      }
    });

  await assert.rejects(update(aId, HOST_B), { status: 409 });
  assert.equal((await link(aId))?.state, 'unlinked');
  const originalRevision = (await link(aId))!.sourceRevision;
  await update(aId, HOST_A);
  await update(bId, HOST_B);
  assert.equal((await link(aId))?.hostPublicKey, HOST_A);
  assert.equal((await link(bId))?.hostPublicKey, HOST_B);
  assert.equal((await sources())[0]!.descriptor.path, (await sources())[1]!.descriptor.path);
  await assert.rejects(update(aId, null, originalRevision), { status: 409 });
  await recordRunnerHeartbeat({
    ctx,
    executionTargetId: targetA,
    runnerInstanceId: 'ambiguous-native-latch',
    relation: 'native'
  });
  assert.equal((await link(aId))?.state, 'ambiguous');
  assert.equal((await link(aId))?.hostPublicKey, undefined);
  await assert.rejects(update(aId, HOST_B), { status: 409 });
  db.prepare(
    "UPDATE execution_target_runner_registrations SET deleted_at = ? WHERE runner_instance_id = 'ambiguous-native-latch'"
  ).run(new Date().toISOString());

  shareTarget(targetA);
  await dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveProfileId('other-latch-account');
    assert.ok((await sources()).every(source => !source.latchHostLink));
    await assert.rejects(update(aId, null, originalRevision + 1), { status: 404 });
  });

  hosts.set(targetB, HOST_A);
  await update(bId, HOST_A);
  assert.equal((await link(aId))?.state, 'ambiguous');
  assert.equal((await link(aId))?.hostPublicKey, undefined);
  assert.equal((await link(bId))?.hostPublicKey, undefined);
  await deleteProjectResourceSource(project.id, a.id, bId);
  assert.equal(await link(bId), undefined);
  assert.equal((await link(aId))?.hostPublicKey, HOST_A);

  await updateProjectResourceSource(project.id, a.id, aId, { launchDefaults: {} });
  assert.equal((await link(aId))?.state, 'unlinked');
  hosts.set(targetA, HOST_B);
  await update(aId, HOST_B);
  assert.equal((await link(aId))?.hostPublicKey, HOST_B);
  db.prepare(
    "UPDATE workspace_user_execution_targets SET access_status = 'disabled' WHERE workspace_user_id = ? AND execution_target_id = ?"
  ).run(ctx.actorWorkspaceUserId, targetA);
  assert.equal(await link(aId), undefined);
  db.prepare(
    "UPDATE workspace_user_execution_targets SET access_status = 'active' WHERE workspace_user_id = ? AND execution_target_id = ?"
  ).run(ctx.actorWorkspaceUserId, targetA);
  await update(aId, null);
  assert.equal((await link(aId))?.state, 'unlinked');
  assert.equal(probe.mock.callCount(), 5);
});

test('the real queue accepts proof only from the target owner’s registered native runner', async () => {
  const project = await createProject({ name: 'Authenticated native runner verification' });
  const resource = await createProjectResource(project.id, { directoryPath: tempDir });
  const source = resource.sources[0]!;
  const targetId = source.executionTargetId!;
  await recordRunnerHeartbeat({ ctx, executionTargetId: targetId, ...runner, relation: 'native' });
  const pending = updateProjectResourceLatchHost({
    projectId: project.id,
    resourceId: resource.id,
    sourceId: source.id,
    body: { sourceRevision: 1, hostPublicKey: HOST_A }
  });
  const finished = pending.then(
    result => ({ result }),
    error => ({ error })
  );
  const deadline = Date.now() + 3000;
  while (
    !db
      .prepare("SELECT 1 FROM execution_requests WHERE project_id = ? AND status = 'queued'")
      .get(project.id)
  ) {
    assert.ok(Date.now() < deadline, 'Expected an identity probe on the runner queue');
    await setTimeout(10);
  }

  shareTarget(targetId);
  const nonOwner = await claimNextExecutionRequest({
    ctx: { ...ctx, actorWorkspaceUserId: otherActor },
    projectId: project.id,
    runner: {
      executionTargetId: targetId,
      runnerInstanceId: 'other-account-latch',
      relation: 'native'
    }
  });
  assert.equal(nonOwner, null);
  db.prepare(
    "UPDATE execution_target_runner_registrations SET deleted_at = ? WHERE runner_instance_id = 'other-account-latch'"
  ).run(new Date().toISOString());
  const adopted = await claimNextExecutionRequest({
    ctx,
    projectId: project.id,
    runner: { runnerInstanceId: 'adopted-latch', relation: 'adopted' }
  });
  assert.equal(adopted, null);
  const request = await claimNextExecutionRequest({ ctx, projectId: project.id, runner });
  assert.ok(request);
  const mutation = parseLocalTargetMutation(request.metadata);
  assert.ok(mutation);
  const target = {
    executionTargetId: targetId,
    deviceLabel: null,
    transport: 'in_process'
  } as const;
  const provider = new FakeLocalTargetProvider({
    target,
    handlers: {
      readLatchHostIdentity: async () => ok(target, { hostKeyDigest: latchHostKeyDigest(HOST_A) })
    }
  });
  const result = await executeLocalTargetMutation({
    mutation,
    provider,
    workingDirectory: request.workingDirectory
  });
  await assert.rejects(
    completeLocalTargetMutationRequest({
      ctx: { ...ctx, actorWorkspaceUserId: otherActor },
      requestId: request.id,
      result
    }),
    { code: 'latch_host_unverified' }
  );
  await completeLocalTargetMutationRequest({ ctx, requestId: request.id, result });
  assert.deepEqual(await finished, { result: { ok: true } });
  assert.equal(
    (await listProjectResources(project.id))[0]!.sources[0]!.latchHostLink?.hostPublicKey,
    HOST_A
  );
});

test('resource settings route validates input and returns a private resource projection', async t => {
  const project = await createProject({ name: 'Latch host settings route' });
  const resource = await createProjectResource(project.id, { directoryPath: tempDir });
  const source = resource.sources[0]!;
  const targetId = source.executionTargetId!;
  await recordRunnerHeartbeat({ ctx, executionTargetId: targetId, ...runner, relation: 'native' });
  t.mock.method(
    RunnerQueueProvider.prototype,
    'readLatchHostIdentity',
    async function (this: RunnerQueueProvider) {
      return ok(this.target, { hostKeyDigest: latchHostKeyDigest(HOST_A) });
    }
  );

  const { secret } = await createUserToken({ label: 'Latch resource route test' });
  const authorization = { Authorization: `Bearer ${secret}` };
  const { app } = await import('./app.ts');
  const server = await listenForTest(app);
  t.after(server.close);
  const resources = `${server.baseUrl}/api/projects/${project.id}/resources`;
  const linkUrl = `${resources}/${resource.id}/sources/${source.id}/latch-host`;
  const put = (body: unknown) =>
    fetch(linkUrl, {
      method: 'PUT',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  assert.equal((await fetch(linkUrl, { method: 'PUT' })).status, 401);
  assert.equal((await put({ hostPublicKey: HOST_A })).status, 400);
  assert.equal((await put({ sourceRevision: 1, hostPublicKey: HOST_B })).status, 409);
  const linked = await put({ sourceRevision: 1, hostPublicKey: HOST_A });
  assert.equal(linked.status, 200);
  assert.deepEqual(await linked.json(), { ok: true });
  assert.equal((await put({ sourceRevision: 1, hostPublicKey: HOST_A })).status, 200);
  const listed = await fetch(resources, { headers: authorization });
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'private, no-store');
  const [row] = (await listed.json()) as Awaited<ReturnType<typeof listProjectResources>>;
  assert.equal(row?.sources[0]?.latchHostLink?.hostPublicKey, HOST_A);
});
