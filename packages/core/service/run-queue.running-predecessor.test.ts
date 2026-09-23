import { planRunQueueDispatch } from '@overlord/automations';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import { createRunQueue, enqueueRunQueueEntry, listProjectRunQueues } from './run-queue.js';
import { createSeededServiceContext } from './test-helpers.js';

async function missionWith(names: string[]) {
  const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
  const project = await createProject({ ctx, name: `Running Predecessor ${names.length}` });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: names.map(objective => ({ objective }))
  });
  const missionQueue = async () =>
    (await listProjectRunQueues(db, project.id)).queues.find(
      queue => queue.missionId === mission.id
    );
  return { db, ctx, project, mission, objectives, missionQueue };
}

describe('Run Queue queueing behind a running objective', () => {
  it('seeds the running sibling ahead and creates the queue running', async () => {
    const { db, project, objectives, missionQueue } = await missionWith(['First', 'Second']);
    const [first, second] = objectives as [(typeof objectives)[0], (typeof objectives)[0]];
    await db.run("UPDATE objectives SET state = 'executing' WHERE id = ?", [first.id]);

    await enqueueRunQueueEntry(db, project.id, second.id);

    const queue = await missionQueue();
    assert.ok(queue);
    assert.equal(queue.paused, false);
    assert.deepEqual(
      queue.entries.map(entry => [entry.objectiveId, entry.state]),
      [
        [first.id, 'running'],
        [second.id, 'waiting']
      ]
    );

    // The planner holds the queued objective while its predecessor runs, then
    // dispatches it once delivery removes the running entry.
    const plan = (entries: typeof queue.entries) =>
      planRunQueueDispatch({
        queues: [{ id: queue.id, paused: queue.paused, position: queue.position }],
        entries: entries.map(entry => ({
          id: entry.id,
          queueId: entry.queueId,
          objectiveId: entry.objectiveId,
          position: entry.position,
          state: entry.state,
          attemptCount: entry.attemptCount
        })),
        objectives: {
          [second.id]: {
            id: second.id,
            missionId: second.missionId,
            state: 'draft',
            instructionText: 'Second'
          }
        }
      });
    assert.deepEqual(plan(queue.entries), []);
    assert.deepEqual(
      plan(queue.entries.filter(entry => entry.objectiveId === second.id)).map(
        action => action.action
      ),
      ['dispatch']
    );

    await db.close();
  });

  it('links the running sibling to its latest execution request', async () => {
    const { db, ctx, project, mission, objectives, missionQueue } = await missionWith([
      'First',
      'Second',
      'Third'
    ]);
    const [first, second, third] = objectives as [
      (typeof objectives)[0],
      (typeof objectives)[0],
      (typeof objectives)[0]
    ];
    await db.run("UPDATE objectives SET state = 'launching' WHERE id = ?", [first.id]);
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO execution_requests
         (id, workspace_id, project_id, mission_id, objective_id, requested_agent,
          launch_mode, launch_flags_json, requested_source, status,
          created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, 'codex', 'run', '{}', 'webapp', 'claimed', ?, ?, 1)`,
      ['request-first', ctx.workspace.id, project.id, mission.id, first.id, now, now]
    );

    await enqueueRunQueueEntry(db, project.id, second.id);

    const queue = await missionQueue();
    assert.ok(queue);
    assert.equal(queue.paused, false);
    assert.deepEqual(
      queue.entries.map(entry => [entry.objectiveId, entry.state, entry.executionRequestId]),
      [
        [first.id, 'running', 'request-first'],
        [second.id, 'waiting', null],
        [third.id, 'waiting', null]
      ]
    );

    await db.close();
  });

  it('keeps the new queue paused when no earlier sibling is running', async () => {
    const { db, project, objectives, missionQueue } = await missionWith(['First', 'Second']);
    const [first, second] = objectives as [(typeof objectives)[0], (typeof objectives)[0]];
    // A launch with no live request is wedged, not running.
    await db.run("UPDATE objectives SET state = 'launching' WHERE id = ?", [first.id]);

    await enqueueRunQueueEntry(db, project.id, second.id);

    const queue = await missionQueue();
    assert.ok(queue);
    assert.equal(queue.paused, true);
    assert.deepEqual(
      queue.entries.map(entry => entry.objectiveId),
      [second.id]
    );

    await db.close();
  });

  it('never seeds a later running sibling', async () => {
    const { db, project, objectives, missionQueue } = await missionWith(['First', 'Second']);
    const [first, second] = objectives as [(typeof objectives)[0], (typeof objectives)[0]];
    await db.run("UPDATE objectives SET state = 'executing' WHERE id = ?", [second.id]);

    await enqueueRunQueueEntry(db, project.id, first.id);

    const queue = await missionQueue();
    assert.ok(queue);
    assert.equal(queue.paused, true);
    assert.deepEqual(
      queue.entries.map(entry => entry.objectiveId),
      [first.id]
    );

    await db.close();
  });

  it('leaves an existing paused queue alone', async () => {
    const { db, ctx, project, mission, objectives } = await missionWith(['First', 'Second']);
    const [first, second] = objectives as [(typeof objectives)[0], (typeof objectives)[0]];
    await db.run("UPDATE objectives SET state = 'executing' WHERE id = ?", [first.id]);
    const manual = await createRunQueue(
      db,
      project.id,
      'Manual',
      ctx.actorWorkspaceUserId,
      mission.id
    );

    await enqueueRunQueueEntry(db, project.id, second.id, { queueId: manual.id });

    const queue = (await listProjectRunQueues(db, project.id)).queues.find(
      item => item.id === manual.id
    );
    assert.ok(queue);
    assert.equal(queue.paused, true);
    assert.deepEqual(
      queue.entries.map(entry => entry.objectiveId),
      [second.id]
    );

    await db.close();
  });
});
