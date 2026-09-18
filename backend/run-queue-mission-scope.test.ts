import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join('/tmp', 'ovld-run-queue-mission-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const bootstrap = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});
const { createProject, reorderFutureObjectives, updateObjective } = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const {
  deleteRunQueueEntry,
  getProjectRunQueues,
  patchRunQueueEntry,
  postProjectRunQueue,
  postRunQueueEntry
} = await import('./run-queue.ts');
const { dispatchProjectRunQueues } = await import('./run-queue-dispatch-worker.ts');
const { requireDatabaseClient } = await import('./db.ts');

type CreatedMission = {
  missionId: string;
  objectives: Array<{ id: string; displayId: string }>;
};

/** One mission with `count` unqueued draft objectives. */
async function mission(projectId: string, count: number, label: string): Promise<CreatedMission> {
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': projectId,
      '--objectives-json': JSON.stringify(
        Array.from({ length: count }, (_, index) => ({ objective: `${label} objective ${index}` }))
      )
    }
  })) as { objectives: Array<{ id: string; displayId: string }> };
  const row = bootstrap.db
    .prepare('SELECT mission_id FROM objectives WHERE id = ?')
    .get(created.objectives[0]!.id) as { mission_id: string };
  return { missionId: row.mission_id, objectives: created.objectives };
}

test('queuing an objective creates its mission queue once and reuses it afterwards', async () => {
  const project = await createProject({ name: `Mission queue ${Date.now()}` });
  const first = await mission(project.id, 2, 'First');
  const second = await mission(project.id, 1, 'Second');

  // No queue exists until something is actually queued.
  assert.equal((await getProjectRunQueues(project.id)).queues.length, 0);

  await postRunQueueEntry(project.id, { objectiveId: first.objectives[0]!.id });
  let queues = (await getProjectRunQueues(project.id)).queues;
  assert.equal(queues.length, 1);
  assert.equal(queues[0]!.missionId, first.missionId);
  assert.equal(queues[0]!.isDefault, false);
  assert.equal(queues[0]!.paused, true);

  // A sibling from the same mission joins the queue rather than creating one.
  await postRunQueueEntry(project.id, { objectiveId: first.objectives[1]!.id });
  queues = (await getProjectRunQueues(project.id)).queues;
  assert.equal(queues.length, 1);
  assert.equal(queues[0]!.entries.length, 2);

  // A different mission gets its own queue — one per queued mission, no more.
  await postRunQueueEntry(project.id, { objectiveId: second.objectives[0]!.id });
  queues = (await getProjectRunQueues(project.id)).queues;
  assert.equal(queues.length, 2);
  assert.deepEqual(
    queues.map(queue => queue.missionId).sort(),
    [first.missionId, second.missionId].sort()
  );
});

test('an explicit queue id still wins over the mission default', async () => {
  const project = await createProject({ name: `Explicit queue ${Date.now()}` });
  const first = await mission(project.id, 1, 'First');
  const second = await mission(project.id, 1, 'Second');

  await postRunQueueEntry(project.id, { objectiveId: first.objectives[0]!.id });
  const missionQueue = (await getProjectRunQueues(project.id)).queues[0]!;

  await postRunQueueEntry(project.id, {
    objectiveId: second.objectives[0]!.id,
    queueId: missionQueue.id
  });
  const queues = (await getProjectRunQueues(project.id)).queues;
  assert.equal(queues.length, 1);
  assert.equal(queues[0]!.entries.length, 2);
});

test('removing the last entry retires the mission queue it emptied', async () => {
  const project = await createProject({ name: `Queue cleanup ${Date.now()}` });
  const only = await mission(project.id, 1, 'Only');

  const entry = await postRunQueueEntry(project.id, { objectiveId: only.objectives[0]!.id });
  await deleteRunQueueEntry(entry.id);

  assert.equal((await getProjectRunQueues(project.id)).queues.length, 0);
});

test('a manual queue stays while pristine and retires once used and emptied', async () => {
  const project = await createProject({ name: `Manual queue ${Date.now()}` });
  const only = await mission(project.id, 1, 'Manual');
  const manual = await postProjectRunQueue(project.id, { name: 'Hand made' });

  // Never used: survives a dispatch sweep so an objective can be added to it.
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);
  assert.deepEqual(
    (await getProjectRunQueues(project.id)).queues.map(queue => queue.id),
    [manual.id]
  );

  const entry = await postRunQueueEntry(project.id, {
    objectiveId: only.objectives[0]!.id,
    queueId: manual.id
  });
  const removal = await deleteRunQueueEntry(entry.id);
  assert.equal(removal.removedEmptyQueueId, manual.id);
  assert.equal((await getProjectRunQueues(project.id)).queues.length, 0);
});

test('moving the last entry out retires the source queue', async () => {
  const project = await createProject({ name: `Move cleanup ${Date.now()}` });
  const only = await mission(project.id, 1, 'Mover');
  const target = await postProjectRunQueue(project.id, { name: 'Target' });

  const entry = await postRunQueueEntry(project.id, { objectiveId: only.objectives[0]!.id });
  await patchRunQueueEntry(entry.id, { queueId: target.id });

  const queues = (await getProjectRunQueues(project.id)).queues;
  assert.deepEqual(
    queues.map(queue => queue.id),
    [target.id]
  );
  assert.equal(queues[0]!.entries.length, 1);
});

test('a queue whose entries all completed retires on the next dispatch tick', async () => {
  const project = await createProject({ name: `Completed queue ${Date.now()}` });
  const only = await mission(project.id, 1, 'Done');
  const entry = await postRunQueueEntry(project.id, { objectiveId: only.objectives[0]!.id });

  // The planner only drops finished entries from a running queue.
  bootstrap.db.prepare('UPDATE run_queues SET paused = 0 WHERE id = ?').run(entry.queueId);
  bootstrap.db
    .prepare("UPDATE objectives SET state = 'complete' WHERE id = ?")
    .run(only.objectives[0]!.id);
  await dispatchProjectRunQueues(requireDatabaseClient(), project.id);

  assert.equal((await getProjectRunQueues(project.id)).queues.length, 0);
});

test('forced removal frees an in-flight entry whose objective is stuck launching', async () => {
  const project = await createProject({ name: `Stuck queue ${Date.now()}` });
  const stuck = await mission(project.id, 2, 'Stuck');
  const objectiveId = stuck.objectives[0]!.id;

  const entry = await postRunQueueEntry(project.id, { objectiveId });
  await postRunQueueEntry(project.id, { objectiveId: stuck.objectives[1]!.id });
  // Reproduce the wedge: a dispatch that never reached a runner.
  bootstrap.db
    .prepare("UPDATE run_queue_entries SET state = 'dispatched' WHERE id = ?")
    .run(entry.id);
  bootstrap.db.prepare('UPDATE run_queues SET paused = 0 WHERE id = ?').run(entry.queueId);
  bootstrap.db.prepare("UPDATE objectives SET state = 'launching' WHERE id = ?").run(objectiveId);

  const result = await deleteRunQueueEntry(entry.id, { force: true });
  assert.equal(result.removed, true);
  assert.equal(result.forced, true);
  assert.equal(result.previousState, 'dispatched');
  assert.equal(result.objectiveReset, true);

  const objective = bootstrap.db
    .prepare('SELECT state FROM objectives WHERE id = ?')
    .get(objectiveId) as { state: string };
  assert.equal(objective.state, 'draft');

  const queues = (await getProjectRunQueues(project.id)).queues;
  assert.equal(queues.length, 1);
  assert.equal(queues[0]!.paused, true);
  assert.deepEqual(
    queues[0]!.entries.map(item => item.objectiveId),
    [stuck.objectives[1]!.id]
  );
});

test('disconnecting an executing objective pauses its active queue', async () => {
  const project = await createProject({ name: `Disconnect queue ${Date.now()}` });
  const queued = await mission(project.id, 2, 'Disconnect');
  const objectiveId = queued.objectives[0]!.id;

  await postRunQueueEntry(project.id, { objectiveId });
  await postRunQueueEntry(project.id, { objectiveId: queued.objectives[1]!.id });
  const queue = (await getProjectRunQueues(project.id)).queues[0]!;
  bootstrap.db.prepare('UPDATE run_queues SET paused = 0 WHERE id = ?').run(queue.id);
  bootstrap.db.prepare("UPDATE objectives SET state = 'executing' WHERE id = ?").run(objectiveId);

  await updateObjective(objectiveId, { state: 'draft' });

  const afterDisconnect = (await getProjectRunQueues(project.id)).queues[0]!;
  assert.equal(afterDisconnect.paused, true);
  assert.deepEqual(
    afterDisconnect.entries.map(item => item.objectiveId),
    [queued.objectives[1]!.id]
  );
});

test('an unforced removal leaves a stuck objective state alone', async () => {
  const project = await createProject({ name: `Plain removal ${Date.now()}` });
  const plain = await mission(project.id, 1, 'Plain');
  const objectiveId = plain.objectives[0]!.id;

  const entry = await postRunQueueEntry(project.id, { objectiveId });
  bootstrap.db
    .prepare("UPDATE run_queue_entries SET state = 'dispatched' WHERE id = ?")
    .run(entry.id);
  bootstrap.db.prepare("UPDATE objectives SET state = 'launching' WHERE id = ?").run(objectiveId);

  const result = await deleteRunQueueEntry(entry.id);
  assert.equal(result.objectiveReset, false);
  const objective = bootstrap.db
    .prepare('SELECT state FROM objectives WHERE id = ?')
    .get(objectiveId) as { state: string };
  assert.equal(objective.state, 'launching');
});

test('reordering a mission carries the new order into its Run Queue', async () => {
  const project = await createProject({ name: `Mission reorder ${Date.now()}` });
  const created = await mission(project.id, 4, 'Reorder');
  const [, second, third, fourth] = created.objectives.map(objective => objective.id);

  // Queuing the second objective queues everything after it as well.
  await postRunQueueEntry(project.id, { objectiveId: second! });
  const queueOrder = async () =>
    (await getProjectRunQueues(project.id)).queues
      .find(queue => queue.missionId === created.missionId)!
      .entries.map(entry => entry.objectiveId);
  assert.deepEqual(await queueOrder(), [second, third, fourth]);

  await reorderFutureObjectives(created.missionId, {
    orderedObjectiveIds: [fourth!, second!, third!]
  });
  assert.deepEqual(await queueOrder(), [fourth, second, third]);
});
