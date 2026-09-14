import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMissionWithObjectives, listObjectives } from './missions.js';
import { createProject } from './projects.js';
import { attachSession } from './protocol.js';
import { listProjectRunQueues, removeRunQueueEntry, reorderRunQueue } from './run-queue.js';
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

    await removeRunQueueEntry(db, thirdEntry.id);
    assert.deepEqual(
      (await listObjectives({ ctx, missionId: mission.id })).map(objective => objective.id),
      [first.id, third.id, second.id]
    );

    await db.close();
  });
});
