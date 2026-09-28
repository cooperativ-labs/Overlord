import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join('/tmp', 'ovld-run-queue-dispatch-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const bootstrap = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});
const { createProject, createProjectResource } = await import('./repository.ts');
const { createIsolatedCheckout } = await import('@overlord/core/service/test-checkout');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { patchRunQueue, postRunQueueEntry } = await import('./run-queue.ts');
const { dispatchProjectRunQueues } = await import('./run-queue-dispatch-worker.ts');
const { buildWebappServiceContextForWorkspace, requireDatabaseClient } = await import('./db.ts');
const { createExecutionRequest } = await import('../packages/core/service/execution-requests.ts');

type EntryState = {
  state: string;
  blocked_reason: string | null;
  waiting_reason: string | null;
  waiting_on_objective_id: string | null;
  revision: number;
};

/** A mission with two agent-assigned draft objectives, neither queued yet. */
async function twoObjectiveMission(projectId: string, label: string) {
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': projectId,
      '--objectives-json': JSON.stringify([
        { objective: `${label} first` },
        { objective: `${label} second` }
      ])
    }
  })) as { objectives: Array<{ id: string }> };
  const ids = created.objectives.map(objective => objective.id);
  for (const id of ids)
    bootstrap.db.prepare("UPDATE objectives SET assigned_agent = 'codex' WHERE id = ?").run(id);
  const { mission_id: missionId } = bootstrap.db
    .prepare('SELECT mission_id FROM objectives WHERE id = ?')
    .get(ids[0]!) as { mission_id: string };
  return { missionId, first: ids[0]!, second: ids[1]! };
}

function entryFor(objectiveId: string): EntryState {
  return bootstrap.db
    .prepare(
      `SELECT state, blocked_reason, waiting_reason, waiting_on_objective_id, revision
         FROM run_queue_entries WHERE objective_id = ? AND deleted_at IS NULL`
    )
    .get(objectiveId) as EntryState;
}

/**
 * Park the entry at the attempt ceiling so that "eligible to dispatch" resolves
 * to a deterministic `block('dispatch_failed')` instead of a real launch. The
 * point of these tests is which *hold* the dispatcher chooses, not what the
 * runner does with a request afterwards.
 */
function exhaustAttempts(objectiveId: string): void {
  bootstrap.db
    .prepare('UPDATE run_queue_entries SET attempt_count = 3 WHERE objective_id = ?')
    .run(objectiveId);
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

test('a serial mission holds its second objective as waiting, and releases it when the sibling finishes', async () => {
  const project = await createProject({ name: `Serial dispatch ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Serial');
  // Queue before the sibling starts: queueing behind an already-running
  // sibling would seed it into the queue ahead (covered below), and the point
  // here is the sibling lock across a queue that does not hold the sibling.
  await postRunQueueEntry(project.id, { objectiveId: mission.second });
  bootstrap.db.prepare("UPDATE objectives SET state = 'executing' WHERE id = ?").run(mission.first);
  exhaustAttempts(mission.second);

  // Creating the mission queue by adding its first entry must not launch it.
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(mission.second).state, 'waiting');
  assert.equal(entryFor(mission.second).waiting_reason, null);

  await startObjectiveQueue(mission.second);
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  const held = entryFor(mission.second);
  assert.equal(held.state, 'waiting');
  assert.equal(held.waiting_reason, 'mission_busy');
  assert.equal(held.waiting_on_objective_id, mission.first);
  assert.equal(held.blocked_reason, null);

  // A second tick with nothing changed must not churn the row: the planner now
  // re-evaluates every hold, so a non-idempotent write would bump `revision`
  // and emit a change event on every 60 s sweep, forever.
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(mission.second).revision, held.revision);

  // The sibling delivers. Nothing touches the queue entry — the next tick alone
  // has to release it, which is exactly what the old `blocked` hold never did.
  bootstrap.db.prepare("UPDATE objectives SET state = 'complete' WHERE id = ?").run(mission.first);
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  const released = entryFor(mission.second);
  assert.equal(released.waiting_reason, null);
  assert.equal(released.state, 'blocked');
  assert.equal(released.blocked_reason, 'dispatch_failed');
});

test('queueing behind a running sibling seeds it ahead in a running queue, then advances on delivery', async () => {
  const project = await createProject({ name: `Running predecessor ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Predecessor');
  bootstrap.db.prepare("UPDATE objectives SET state = 'executing' WHERE id = ?").run(mission.first);
  await postRunQueueEntry(project.id, { objectiveId: mission.second });
  exhaustAttempts(mission.second);

  const queue = bootstrap.db
    .prepare(
      `SELECT q.paused FROM run_queues q
         JOIN run_queue_entries e ON e.queue_id = q.id AND e.deleted_at IS NULL
        WHERE e.objective_id = ?`
    )
    .get(mission.second) as { paused: number };
  assert.equal(queue.paused, 0);
  assert.equal(entryFor(mission.first).state, 'running');

  // The running predecessor holds the queue; nothing is dispatched or held.
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(mission.first).state, 'running');
  assert.equal(entryFor(mission.second).state, 'waiting');
  assert.equal(entryFor(mission.second).waiting_reason, null);

  // Delivery completes the predecessor and removes its entry; the next tick
  // reaches the queued objective without the user resuming anything.
  bootstrap.db.prepare("UPDATE objectives SET state = 'complete' WHERE id = ?").run(mission.first);
  bootstrap.db
    .prepare("UPDATE run_queue_entries SET deleted_at = datetime('now') WHERE objective_id = ?")
    .run(mission.first);
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(mission.second).state, 'blocked');
  assert.equal(entryFor(mission.second).blocked_reason, 'dispatch_failed');
});

test('a mission that allows parallel objectives is never held for a busy sibling', async () => {
  const project = await createProject({ name: `Parallel dispatch ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Parallel');
  bootstrap.db
    .prepare('UPDATE missions SET allow_parallel_objectives = 1 WHERE id = ?')
    .run(mission.missionId);
  await postRunQueueEntry(project.id, { objectiveId: mission.second });
  bootstrap.db.prepare("UPDATE objectives SET state = 'executing' WHERE id = ?").run(mission.first);
  exhaustAttempts(mission.second);
  await startObjectiveQueue(mission.second);

  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  const entry = entryFor(mission.second);
  assert.equal(entry.waiting_reason, null);
  assert.equal(entry.state, 'blocked');
  assert.equal(entry.blocked_reason, 'dispatch_failed');
});

test('an objective with no agent blocks, and the block is re-evaluated once one is assigned', async () => {
  const project = await createProject({ name: `No agent ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Unassigned');
  bootstrap.db
    .prepare('UPDATE objectives SET assigned_agent = NULL WHERE id = ?')
    .run(mission.first);
  await postRunQueueEntry(project.id, { objectiveId: mission.first });
  exhaustAttempts(mission.first);
  await startObjectiveQueue(mission.first);

  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(mission.first).blocked_reason, 'no_agent');

  bootstrap.db
    .prepare("UPDATE objectives SET assigned_agent = 'codex' WHERE id = ?")
    .run(mission.first);
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(mission.first).blocked_reason, 'dispatch_failed');
});

test('an entry for a completed objective is dropped even after it was blocked', async () => {
  const project = await createProject({ name: `Dropped ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Dropped');
  bootstrap.db
    .prepare('UPDATE objectives SET assigned_agent = NULL WHERE id = ?')
    .run(mission.first);
  await postRunQueueEntry(project.id, { objectiveId: mission.first });
  await startObjectiveQueue(mission.first);

  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(mission.first).state, 'blocked');

  bootstrap.db.prepare("UPDATE objectives SET state = 'complete' WHERE id = ?").run(mission.first);
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(mission.first), undefined);
});

// ---- Row-state characterization -------------------------------------------
//
// Every transition the dispatcher writes, asserted on the full column set it
// owns. These pin the behavior the core transition functions must keep.

type FullEntry = EntryState & {
  id: string;
  attempt_count: number;
  execution_request_id: string | null;
  dispatched_at: string | null;
  deleted_at: string | null;
};

function fullEntryFor(objectiveId: string): FullEntry {
  return bootstrap.db
    .prepare(
      `SELECT id, state, blocked_reason, waiting_reason, waiting_on_objective_id, revision,
              attempt_count, execution_request_id, dispatched_at, deleted_at
         FROM run_queue_entries WHERE objective_id = ?
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(objectiveId) as FullEntry;
}

function objectiveState(objectiveId: string): string {
  return (
    bootstrap.db.prepare('SELECT state FROM objectives WHERE id = ?').get(objectiveId) as {
      state: string;
    }
  ).state;
}

test('drop soft-deletes the entry of a completed objective', async () => {
  const project = await createProject({ name: `Drop row ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Drop row');
  await postRunQueueEntry(project.id, { objectiveId: mission.first });
  await startObjectiveQueue(mission.first);
  bootstrap.db.prepare("UPDATE objectives SET state = 'complete' WHERE id = ?").run(mission.first);

  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  const row = fullEntryFor(mission.first);
  assert.ok(row.deleted_at, 'the entry is soft-deleted');
  assert.equal(row.state, 'waiting', 'drop does not rewrite state');
});

test('mark_running reflects an objective started outside the queue and clears every hold', async () => {
  const project = await createProject({ name: `Mark running ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Mark running');
  await postRunQueueEntry(project.id, { objectiveId: mission.first });
  await startObjectiveQueue(mission.first);
  bootstrap.db
    .prepare(
      "UPDATE run_queue_entries SET state = 'blocked', blocked_reason = 'no_agent', waiting_reason = 'mission_busy', waiting_on_objective_id = ? WHERE objective_id = ?"
    )
    .run(mission.second, mission.first);
  bootstrap.db.prepare("UPDATE objectives SET state = 'executing' WHERE id = ?").run(mission.first);

  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  const row = fullEntryFor(mission.first);
  assert.equal(row.state, 'running');
  assert.equal(row.blocked_reason, null);
  assert.equal(row.waiting_reason, null);
  assert.equal(row.waiting_on_objective_id, null);
  assert.equal(row.attempt_count, 0, 'marking running spends no attempt');
  assert.equal(row.execution_request_id, null);
});

test('a waiting hold after a failed attempt clears the failure detail', async () => {
  const project = await createProject({ name: `Hold clears ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Hold clears');
  await postRunQueueEntry(project.id, { objectiveId: mission.second });
  await startObjectiveQueue(mission.second);
  bootstrap.db
    .prepare(
      "UPDATE run_queue_entries SET waiting_reason = 'retry_pending', blocked_reason = 'dispatch_failed: boom', attempt_count = 1 WHERE objective_id = ?"
    )
    .run(mission.second);
  bootstrap.db.prepare("UPDATE objectives SET state = 'executing' WHERE id = ?").run(mission.first);

  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  const row = fullEntryFor(mission.second);
  assert.equal(row.state, 'waiting');
  assert.equal(row.waiting_reason, 'mission_busy');
  assert.equal(row.waiting_on_objective_id, mission.first);
  assert.equal(row.blocked_reason, null, 'the entry is not failing, it is not its turn');
  assert.equal(row.attempt_count, 1, 'a hold never refunds attempts');
});

test('a failed dispatch waits as retry_pending with the cause and no request link', async () => {
  const project = await createProject({ name: `Dispatch failure row ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Dispatch failure row');
  await postRunQueueEntry(project.id, { objectiveId: mission.first });
  await startObjectiveQueue(mission.first);
  // No resource is linked, so the launch inside the dispatch transaction throws.
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);

  const row = fullEntryFor(mission.first);
  assert.equal(row.state, 'waiting');
  assert.equal(row.waiting_reason, 'retry_pending');
  assert.equal(row.waiting_on_objective_id, null);
  assert.match(row.blocked_reason ?? '', /^dispatch_failed(: .+)?$/);
  assert.ok((row.blocked_reason ?? '').length <= 'dispatch_failed: '.length + 400);
  assert.equal(row.attempt_count, 1);
  assert.equal(row.execution_request_id, null);
  assert.equal(row.dispatched_at, null);
  // The dispatch transaction rolled back, including the objective's launch.
  assert.equal(objectiveState(mission.first), 'draft');

  // At the ceiling the block keeps that cause instead of the bare reason.
  exhaustAttempts(mission.first);
  const cause = row.blocked_reason;
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  const blocked = fullEntryFor(mission.first);
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.blocked_reason, cause);
  assert.equal(blocked.waiting_reason, null);
});

test('a successful dispatch links the request, spends one attempt, and clears every hold', async () => {
  const project = await createProject({ name: `Dispatched row ${Date.now()}` });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-run-queue-dispatched-'),
    executionTargetId: null,
    isPrimary: true
  });
  const mission = await twoObjectiveMission(project.id, 'Dispatched row');
  await postRunQueueEntry(project.id, { objectiveId: mission.first });
  await startObjectiveQueue(mission.first);
  bootstrap.db
    .prepare(
      "UPDATE run_queue_entries SET waiting_reason = 'retry_pending', blocked_reason = 'dispatch_failed: earlier', attempt_count = 1 WHERE objective_id = ?"
    )
    .run(mission.first);

  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  const row = fullEntryFor(mission.first);
  assert.equal(row.state, 'dispatched');
  assert.equal(row.blocked_reason, null);
  assert.equal(row.waiting_reason, null);
  assert.equal(row.waiting_on_objective_id, null);
  assert.equal(row.attempt_count, 2);
  assert.ok(row.dispatched_at);
  const request = bootstrap.db
    .prepare(
      'SELECT objective_id, requested_source, idempotency_key FROM execution_requests WHERE id = ?'
    )
    .get(row.execution_request_id) as {
    objective_id: string;
    requested_source: string;
    idempotency_key: string;
  };
  assert.equal(request.objective_id, mission.first);
  assert.equal(request.requested_source, 'run_queue');
  assert.equal(request.idempotency_key, `run_queue:${row.id}:attempt:2`);
  assert.equal(objectiveState(mission.first), 'launching');
});

test('a retry of a launching objective still holding an active request does not reset it', async () => {
  const project = await createProject({ name: `Wedge guard ${Date.now()}` });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('overlord-run-queue-wedge-'),
    executionTargetId: null,
    isPrimary: true
  });
  const mission = await twoObjectiveMission(project.id, 'Wedge guard');
  await postRunQueueEntry(project.id, { objectiveId: mission.first });
  await startObjectiveQueue(mission.first);
  const ctx = await buildWebappServiceContextForWorkspace(
    'local-workspace',
    requireDatabaseClient(),
    null
  );
  await createExecutionRequest({
    ctx,
    missionId: mission.missionId,
    objectiveId: mission.first,
    requestedAgent: 'codex',
    requestedSource: 'webapp',
    idempotencyKey: `wedge-guard-${Date.now()}`
  });
  bootstrap.db.prepare("UPDATE objectives SET state = 'launching' WHERE id = ?").run(mission.first);

  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(objectiveState(mission.first), 'launching', 'an active request means not wedged');
});
