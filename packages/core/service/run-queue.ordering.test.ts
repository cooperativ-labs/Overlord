import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMissionWithObjectives, listObjectives } from './missions.js';
import { createProject } from './projects.js';
import { attachSession } from './protocol.js';
import {
  enqueueRunQueueEntry,
  listProjectRunQueues,
  removeRunQueueEntry,
  reorderRunQueue,
  syncRunQueueOrderFromMissionPositions
} from './run-queue.js';
import { createSeededServiceContext } from './test-helpers.js';

describe('Run Queue objective-position write-through', () => {
  it('keeps a later queued objective behind an earlier unqueued objective', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Mixed Queue Ordering' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'First objective' },
        { objective: 'Second objective', autoAdvance: true }
      ]
    });

    const queued = await db.get<{ objective_id: string }>(
      'SELECT objective_id FROM run_queue_entries WHERE mission_id = ? AND deleted_at IS NULL',
      [mission.id]
    );
    assert.equal(queued?.objective_id, objectives[1]!.id);

    const listed = await listObjectives({ ctx, missionId: mission.id });
    assert.deepEqual(
      listed.map(objective => [objective.id, objective.position]),
      [
        [objectives[0]!.id, 0],
        [objectives[1]!.id, 1]
      ]
    );

    await db.run("UPDATE objectives SET state = 'submitted' WHERE id = ?", [objectives[0]!.id]);
    const attached = await attachSession({ ctx, missionId: mission.displayId });
    assert.equal(attached.objective.id, objectives[0]!.id);

    await db.close();
  });

  it('reorders queued spans without crossing an unqueued objective anchor', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Anchored Queue Ordering' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'Unqueued anchor' },
        { objective: 'Queued second', autoAdvance: true },
        { objective: 'Queued third', autoAdvance: true }
      ]
    });
    const first = objectives[0]!;
    const second = objectives[1]!;
    const third = objectives[2]!;

    const missionQueue = (await listProjectRunQueues(db, project.id)).queues.find(
      queue => queue.missionId === mission.id
    );
    assert.ok(missionQueue);
    const secondEntry = missionQueue.entries.find(entry => entry.objectiveId === second.id);
    const thirdEntry = missionQueue.entries.find(entry => entry.objectiveId === third.id);
    assert.ok(secondEntry);
    assert.ok(thirdEntry);

    await reorderRunQueue(db, missionQueue.id, [thirdEntry.id, secondEntry.id]);
    assert.deepEqual(
      (await listObjectives({ ctx, missionId: mission.id })).map(objective => objective.id),
      [first.id, third.id, second.id]
    );

    // A dequeued objective moves to the end of the mission's order.
    await removeRunQueueEntry(db, thirdEntry.id);
    assert.deepEqual(
      (await listObjectives({ ctx, missionId: mission.id })).map(objective => objective.id),
      [first.id, second.id, third.id]
    );

    await db.close();
  });

  it('queues every following objective behind the one that was queued', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Cascade Queue' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'First' },
        { objective: 'Second' },
        { objective: 'Third' },
        { objective: 'Fourth' }
      ]
    });
    const [first, second, third, fourth] = objectives as [
      (typeof objectives)[number],
      (typeof objectives)[number],
      (typeof objectives)[number],
      (typeof objectives)[number]
    ];

    await enqueueRunQueueEntry(db, project.id, second.id);
    const queue = (await listProjectRunQueues(db, project.id)).queues.find(
      item => item.missionId === mission.id
    );
    assert.ok(queue);
    assert.deepEqual(
      queue.entries.map(entry => entry.objectiveId),
      [second.id, third.id, fourth.id]
    );
    assert.deepEqual(
      (await listObjectives({ ctx, missionId: mission.id })).map(objective => objective.id),
      [first.id, second.id, third.id, fourth.id]
    );

    await db.close();
  });

  it('keeps a dequeued objective last when it is queued again', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Requeue Order' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }, { objective: 'Second' }, { objective: 'Third' }]
    });
    const [first, second, third] = objectives as [
      (typeof objectives)[number],
      (typeof objectives)[number],
      (typeof objectives)[number]
    ];
    const missionOrder = async () =>
      (await listObjectives({ ctx, missionId: mission.id })).map(objective => objective.id);
    const queueOrder = async () =>
      (await listProjectRunQueues(db, project.id)).queues
        .find(item => item.missionId === mission.id)
        ?.entries.map(entry => entry.objectiveId) ?? [];

    await enqueueRunQueueEntry(db, project.id, first.id);
    assert.deepEqual(await queueOrder(), [first.id, second.id, third.id]);

    const secondEntry = (await listProjectRunQueues(db, project.id)).queues
      .flatMap(item => item.entries)
      .find(entry => entry.objectiveId === second.id);
    assert.ok(secondEntry);
    await removeRunQueueEntry(db, secondEntry.id);
    assert.deepEqual(await missionOrder(), [first.id, third.id, second.id]);
    assert.deepEqual(await queueOrder(), [first.id, third.id]);

    await enqueueRunQueueEntry(db, project.id, second.id);
    assert.deepEqual(await missionOrder(), [first.id, third.id, second.id]);
    assert.deepEqual(await queueOrder(), [first.id, third.id, second.id]);

    await db.close();
  });

  it('matches mission order in both directions, across an unqueued objective', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Two Way Order' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }, { objective: 'Second' }, { objective: 'Third' }]
    });
    const [first, second, third] = objectives as [
      (typeof objectives)[number],
      (typeof objectives)[number],
      (typeof objectives)[number]
    ];
    const missionOrder = async () =>
      (await listObjectives({ ctx, missionId: mission.id })).map(objective => objective.id);
    const missionQueue = async () => {
      const queue = (await listProjectRunQueues(db, project.id)).queues.find(
        item => item.missionId === mission.id
      );
      assert.ok(queue);
      return queue;
    };

    // Queue first and third only, leaving second as an unqueued anchor between.
    await enqueueRunQueueEntry(db, project.id, first.id, { cascade: false });
    await enqueueRunQueueEntry(db, project.id, third.id, { cascade: false });
    const queue = await missionQueue();
    const entryFor = (objectiveId: string) =>
      queue.entries.find(entry => entry.objectiveId === objectiveId)!.id;

    // Queue reorder writes through to the mission without moving the anchor.
    await reorderRunQueue(db, queue.id, [entryFor(third.id), entryFor(first.id)]);
    assert.deepEqual(await missionOrder(), [third.id, second.id, first.id]);

    // A mission reorder writes through to the queue.
    await db.run('UPDATE objectives SET position = position + 100 WHERE mission_id = ?', [
      mission.id
    ]);
    await db.run('UPDATE objectives SET position = 0 WHERE id = ?', [first.id]);
    await db.run('UPDATE objectives SET position = 1 WHERE id = ?', [second.id]);
    await db.run('UPDATE objectives SET position = 2 WHERE id = ?', [third.id]);
    assert.deepEqual(await syncRunQueueOrderFromMissionPositions(db, mission.id), {
      changed: true
    });
    assert.deepEqual(
      (await missionQueue()).entries.map(entry => entry.objectiveId),
      [first.id, third.id]
    );
    assert.deepEqual(await syncRunQueueOrderFromMissionPositions(db, mission.id), {
      changed: false
    });

    await db.close();
  });
});
