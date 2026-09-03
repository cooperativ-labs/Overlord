import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Phase 2 of planning/feature-plans/run-queue-waiting-vs-blocked.md: a failed
 * attempt is retryable rather than human-actionable, and the events that change
 * what a hold is waiting on ask for a dispatch tick instead of leaving the
 * queue to the 60 s sweep.
 */
const tempDir = mkdtempSync(path.join('/tmp', 'ovld-run-queue-retry-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const bootstrap = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});
const { createProject, createProjectResource, updateMission, updateObjective } =
  await import('./repository.ts');
const { createIsolatedCheckout } = await import('@overlord/core/service/test-checkout');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { patchRunQueue, patchRunQueueEntry, postRunQueueEntry } = await import('./run-queue.ts');
const { dispatchProjectRunQueues } = await import('./run-queue-dispatch-worker.ts');
const { buildWebappServiceContextForWorkspace, requireDatabaseClient } = await import('./db.ts');
const { createExecutionRequest, markExecutionFailed } =
  await import('../packages/core/service/execution-requests.ts');
const { recordRunnerHeartbeat } =
  await import('../packages/core/service/execution-target-runners.ts');

const RUN_QUEUE_JOB = 'overlord.run-queue.dispatch.v1';

type EntryRow = {
  id: string;
  state: string;
  blocked_reason: string | null;
  waiting_reason: string | null;
  attempt_count: number;
  execution_request_id: string | null;
};

/** A project with a linked primary resource, so a real launch can resolve one. */
async function projectWithResource(name: string) {
  const project = await createProject({ name });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-run-queue-retry-'),
    executionTargetId: null,
    isPrimary: true
  });
  return project;
}

async function missionWithObjectives(projectId: string, label: string, count = 2) {
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': projectId,
      '--objectives-json': JSON.stringify(
        Array.from({ length: count }, (_, index) => ({ objective: `${label} ${index + 1}` }))
      )
    }
  })) as { objectives: Array<{ id: string }> };
  const ids = created.objectives.map(objective => objective.id);
  for (const id of ids)
    bootstrap.db.prepare("UPDATE objectives SET assigned_agent = 'codex' WHERE id = ?").run(id);
  const { mission_id: missionId } = bootstrap.db
    .prepare('SELECT mission_id FROM objectives WHERE id = ?')
    .get(ids[0]!) as { mission_id: string };
  return { missionId, ids };
}

function entryFor(objectiveId: string): EntryRow | undefined {
  return bootstrap.db
    .prepare(
      `SELECT id, state, blocked_reason, waiting_reason, attempt_count, execution_request_id
         FROM run_queue_entries WHERE objective_id = ? AND deleted_at IS NULL`
    )
    .get(objectiveId) as EntryRow | undefined;
}

async function startObjectiveQueue(objectiveId: string): Promise<void> {
  const queue = bootstrap.db
    .prepare(
      `SELECT queue_id
         FROM run_queue_entries
        WHERE objective_id = ? AND deleted_at IS NULL`
    )
    .get(objectiveId) as { queue_id: string };
  await patchRunQueue(queue.queue_id, { paused: false });
}

/** Forget every pending dispatch job so the next assertion sees only new ones. */
function clearDispatchJobs(): void {
  bootstrap.db.prepare('DELETE FROM worker_jobs WHERE type = ?').run(RUN_QUEUE_JOB);
}

function pendingDispatchJobs(projectId: string): number {
  const row = bootstrap.db
    .prepare(
      `SELECT COUNT(*) AS n FROM worker_jobs
        WHERE type = ? AND deleted_at IS NULL
          AND json_extract(payload_json, '$.projectId') = ?`
    )
    .get(RUN_QUEUE_JOB, projectId) as { n: number };
  return Number(row.n);
}

test('a dispatch that fails waits and retries, and only blocks once the attempts are spent', async () => {
  const project = await createProject({ name: `Retry accounting ${Date.now()}` });
  const { ids } = await missionWithObjectives(project.id, 'Retry', 1);
  await postRunQueueEntry(project.id, { objectiveId: ids[0]! });
  await startObjectiveQueue(ids[0]!);

  // No execution target is registered in this bootstrap, so every dispatch
  // attempt throws inside the worker — exactly the failure this phase makes
  // retryable rather than terminal.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
    const entry = entryFor(ids[0]!)!;
    assert.equal(entry.attempt_count, attempt);
    if (attempt < 3) {
      assert.equal(entry.state, 'waiting', `attempt ${attempt} stays retryable`);
      assert.equal(entry.waiting_reason, 'retry_pending');
      assert.match(entry.blocked_reason ?? '', /^dispatch_failed/);
    }
  }

  // The ceiling turns the hold into a human-actionable block — and the detail
  // explaining what failed survives the transition.
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  const blocked = entryFor(ids[0]!)!;
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.waiting_reason, null);
  assert.match(blocked.blocked_reason ?? '', /^dispatch_failed:/);
});

test('retry clears the hold, resets the attempt budget, and asks for a tick', async () => {
  const project = await createProject({ name: `Retry operation ${Date.now()}` });
  const { ids } = await missionWithObjectives(project.id, 'Manual retry', 1);
  await postRunQueueEntry(project.id, { objectiveId: ids[0]! });
  await startObjectiveQueue(ids[0]!);
  for (let attempt = 0; attempt < 4; attempt += 1)
    await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  const blocked = entryFor(ids[0]!)!;
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.attempt_count, 3);

  clearDispatchJobs();
  await patchRunQueueEntry(blocked.id, { retry: true });
  const retried = entryFor(ids[0]!)!;
  assert.equal(retried.state, 'waiting');
  assert.equal(retried.waiting_reason, 'retry_pending');
  assert.equal(retried.attempt_count, 0);
  assert.equal(retried.blocked_reason, null);
  assert.equal(pendingDispatchJobs(project.id), 1);

  // The same recovery over the Protocol surface, addressed by objective.
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(ids[0]!)!.attempt_count, 1);
  await runProtocolSubcommand('retry-queue-entry', { flags: { '--objective-id': ids[0]! } });
  assert.equal(entryFor(ids[0]!)!.attempt_count, 0);

  // `--entry` alone is a complete address: an entry id already names its
  // project, so a caller working from a queue listing does not repeat it.
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(ids[0]!)!.attempt_count, 1);
  await runProtocolSubcommand('retry-queue-entry', {
    flags: { '--entry': entryFor(ids[0]!)!.id }
  });
  assert.equal(entryFor(ids[0]!)!.attempt_count, 0);
});

test('an in-flight entry refuses a retry rather than launching its objective twice', async () => {
  const project = await createProject({ name: `Retry in flight ${Date.now()}` });
  const { ids } = await missionWithObjectives(project.id, 'In flight', 1);
  await postRunQueueEntry(project.id, { objectiveId: ids[0]! });
  const entry = entryFor(ids[0]!)!;
  bootstrap.db.prepare("UPDATE run_queue_entries SET state = 'running' WHERE id = ?").run(entry.id);
  await assert.rejects(
    () => patchRunQueueEntry(entry.id, { retry: true }),
    /in-flight Run Queue entry cannot be retried/
  );
});

test('a failed execution request returns its entry to waiting and enqueues a tick', async () => {
  const project = await projectWithResource(`Request failure ${Date.now()}`);
  const { missionId, ids } = await missionWithObjectives(project.id, 'Request', 1);
  await postRunQueueEntry(project.id, { objectiveId: ids[0]! });
  const entry = entryFor(ids[0]!)!;

  const db = requireDatabaseClient();
  const ctx = await buildWebappServiceContextForWorkspace('local-workspace', db, null);
  const request = await createExecutionRequest({
    ctx,
    missionId,
    objectiveId: ids[0]!,
    requestedAgent: 'codex',
    requestedSource: 'run_queue',
    idempotencyKey: `run_queue:${entry.id}:attempt:1`
  });
  bootstrap.db
    .prepare(
      "UPDATE run_queue_entries SET state = 'dispatched', execution_request_id = ?, attempt_count = 1 WHERE id = ?"
    )
    .run(request.id, entry.id);

  clearDispatchJobs();
  await markExecutionFailed({ ctx, requestId: request.id, error: 'runner exploded' });

  const reconciled = entryFor(ids[0]!)!;
  assert.equal(reconciled.state, 'waiting');
  assert.equal(reconciled.waiting_reason, 'retry_pending');
  assert.equal(reconciled.execution_request_id, null);
  assert.equal(reconciled.attempt_count, 2, 'a request-level failure counts as an attempt');
  assert.match(reconciled.blocked_reason ?? '', /^request_failed: runner exploded/);
  assert.equal(pendingDispatchJobs(project.id), 1);
});

test('a run_queue request is refused while a serial mission already has an active objective', async () => {
  const project = await projectWithResource(`Sibling lock ${Date.now()}`);
  const { missionId, ids } = await missionWithObjectives(project.id, 'Sibling');
  bootstrap.db.prepare("UPDATE objectives SET state = 'executing' WHERE id = ?").run(ids[0]!);
  // The second objective is authored as `future`; the dispatcher promotes it at
  // dispatch time, so make it launchable the same way before calling the
  // service directly.
  bootstrap.db.prepare("UPDATE objectives SET state = 'submitted' WHERE id = ?").run(ids[1]!);
  const ctx = await buildWebappServiceContextForWorkspace(
    'local-workspace',
    requireDatabaseClient(),
    null
  );
  await assert.rejects(
    () =>
      createExecutionRequest({
        ctx,
        missionId,
        objectiveId: ids[1]!,
        requestedAgent: 'codex',
        requestedSource: 'run_queue',
        idempotencyKey: `sibling-lock-refused-${Date.now()}`
      }),
    /Mission already has an active objective/
  );

  // The same request is allowed once the mission opts into parallel objectives.
  bootstrap.db
    .prepare('UPDATE missions SET allow_parallel_objectives = 1 WHERE id = ?')
    .run(missionId);
  const allowed = await createExecutionRequest({
    ctx,
    missionId,
    objectiveId: ids[1]!,
    requestedAgent: 'codex',
    requestedSource: 'run_queue',
    idempotencyKey: `sibling-lock-allowed-${Date.now()}`
  });
  assert.equal(allowed.status, 'queued');
});

test('an objective leaving the pipeline drops its queue entry instead of parking it', async () => {
  const project = await createProject({ name: `Dequeue trigger ${Date.now()}` });
  const { ids } = await missionWithObjectives(project.id, 'Dequeue', 1);
  await postRunQueueEntry(project.id, { objectiveId: ids[0]! });
  assert.ok(entryFor(ids[0]!));

  await updateObjective(ids[0]!, { state: 'complete' });
  assert.equal(entryFor(ids[0]!), undefined);
});

test('fixing what a hold asked for, and toggling parallel objectives, each ask for a tick', async () => {
  const project = await createProject({ name: `Trigger gaps ${Date.now()}` });
  const { missionId, ids } = await missionWithObjectives(project.id, 'Triggers', 1);
  bootstrap.db.prepare('UPDATE objectives SET assigned_agent = NULL WHERE id = ?').run(ids[0]!);
  await postRunQueueEntry(project.id, { objectiveId: ids[0]! });
  await startObjectiveQueue(ids[0]!);
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(ids[0]!)!.blocked_reason, 'no_agent');

  clearDispatchJobs();
  await updateObjective(ids[0]!, { assignedAgent: 'codex' });
  assert.equal(pendingDispatchJobs(project.id), 1, 'assigning the agent asks for a tick');

  clearDispatchJobs();
  await updateMission(missionId, { allowParallelObjectives: true });
  assert.equal(pendingDispatchJobs(project.id), 1, 'toggling parallel objectives asks for a tick');
});

test('a runner reconnect asks for a tick, and its steady heartbeats do not', async () => {
  const project = await createProject({ name: `Runner reconnect ${Date.now()}` });
  const { ids } = await missionWithObjectives(project.id, 'Reconnect', 1);
  await postRunQueueEntry(project.id, { objectiveId: ids[0]! });

  const now = new Date().toISOString();
  const targetId = `target-${Date.now()}`;
  const deviceId = `device-${Date.now()}`;
  bootstrap.db
    .prepare(
      `INSERT INTO devices
         (id, workspace_id, fingerprint, label, platform, status, last_seen_at,
          metadata_json, created_at, updated_at, revision)
       VALUES (?, 'local-workspace', ?, 'reconnect', 'darwin', 'active', ?, '{}', ?, ?, 1)`
    )
    .run(deviceId, `fp-${deviceId}`, now, now, now);
  bootstrap.db
    .prepare(
      `INSERT INTO execution_targets
         (id, workspace_id, device_id, owner_workspace_user_id, type, label, status,
          connection_json, created_at, updated_at, revision)
       VALUES (?, 'local-workspace', ?, NULL, 'local', 'reconnect', 'active', '{}', ?, ?, 1)`
    )
    .run(targetId, deviceId, now, now);
  const ctx = await buildWebappServiceContextForWorkspace(
    'local-workspace',
    requireDatabaseClient(),
    null
  );
  const registration = {
    ctx,
    executionTargetId: targetId,
    runnerInstanceId: `runner-${Date.now()}`,
    relation: 'native' as const
  };

  clearDispatchJobs();
  await recordRunnerHeartbeat(registration);
  assert.equal(pendingDispatchJobs(project.id), 1, 'a first registration is a reconnect');

  // A healthy runner beats every few seconds; enqueuing a dispatch job each
  // time would turn the trigger into a second, faster sweep.
  clearDispatchJobs();
  await recordRunnerHeartbeat(registration);
  assert.equal(pendingDispatchJobs(project.id), 0);

  // A gap longer than the liveness window is a reconnect again.
  bootstrap.db
    .prepare(
      'UPDATE execution_target_runner_registrations SET last_heartbeat_at = ? WHERE runner_instance_id = ?'
    )
    .run(new Date(Date.now() - 60 * 60 * 1000).toISOString(), registration.runnerInstanceId);
  await recordRunnerHeartbeat(registration);
  assert.equal(pendingDispatchJobs(project.id), 1);
});
