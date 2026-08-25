import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join('/tmp', 'ovld-run-queue-dispatch-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const bootstrap = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});
const { createProject } = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { postRunQueueEntry } = await import('./run-queue.ts');
const { dispatchProjectRunQueues } = await import('./run-queue-dispatch-worker.ts');
const { requireDatabaseClient } = await import('./db.ts');

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

test('a serial mission holds its second objective as waiting, and releases it when the sibling finishes', async () => {
  const project = await createProject({ name: `Serial dispatch ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Serial');
  bootstrap.db.prepare("UPDATE objectives SET state = 'executing' WHERE id = ?").run(mission.first);
  await postRunQueueEntry(project.id, { objectiveId: mission.second });
  exhaustAttempts(mission.second);

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

test('a mission that allows parallel objectives is never held for a busy sibling', async () => {
  const project = await createProject({ name: `Parallel dispatch ${Date.now()}` });
  const mission = await twoObjectiveMission(project.id, 'Parallel');
  bootstrap.db
    .prepare('UPDATE missions SET allow_parallel_objectives = 1 WHERE id = ?')
    .run(mission.missionId);
  bootstrap.db.prepare("UPDATE objectives SET state = 'executing' WHERE id = ?").run(mission.first);
  await postRunQueueEntry(project.id, { objectiveId: mission.second });
  exhaustAttempts(mission.second);

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

  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(mission.first).state, 'blocked');

  bootstrap.db.prepare("UPDATE objectives SET state = 'complete' WHERE id = ?").run(mission.first);
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.equal(entryFor(mission.first), undefined);
});
