import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

for (const adapter of conformanceAdapters()) {
  describe(`objective queue races [${adapter}]`, () => {
    for (const mutation of ['insert', 'delete', 'reopen', 'launch', 'run-queue'] as const) {
      it(`serializes reorder versus ${mutation} without moving active/history anchors`, async () => {
        const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_queue_race');
        await bindWebappDatabaseClient({ client: db });
        try {
          const repo = await import('./repository.ts');
          const queues = await import('./run-queue.ts');
          const project = await repo.createProject({ name: `Queue race ${mutation}` });
          const mission = await repo.createMission({ projectId: project.id, firstObjective: 'A' });
          const a = mission.objectives[0]!;
          const active = await repo.createObjective({
            missionId: mission.id,
            instructionText: 'Active'
          });
          const b = await repo.createObjective({ missionId: mission.id, instructionText: 'B' });
          const done = await repo.createObjective({
            missionId: mission.id,
            instructionText: 'Done'
          });
          const c = await repo.createObjective({ missionId: mission.id, instructionText: 'C' });
          await db.run("UPDATE objectives SET state = 'executing' WHERE id = ?", [active.id]);
          await db.run("UPDATE objectives SET state = 'complete' WHERE id = ?", [done.id]);
          await db.run('UPDATE objectives SET position = position * 10 + 10 WHERE mission_id = ?', [
            mission.id
          ]);
          const anchor = await db.get('SELECT position, revision FROM objectives WHERE id = ?', [
            active.id
          ]);
          let queue:
            | Awaited<ReturnType<typeof queues.getProjectRunQueues>>['queues'][number]
            | undefined;
          if (mutation === 'run-queue') {
            await queues.postRunQueueEntry(project.id, { objectiveId: a.id });
            queue = (await queues.getProjectRunQueues(project.id)).queues[0]!;
          }
          const competing = () => {
            switch (mutation) {
              case 'insert':
                return repo.createObjective({
                  missionId: mission.id,
                  instructionText: 'Added concurrently'
                });
              case 'delete':
                return repo.deleteObjectives([b.id]);
              case 'reopen':
                return repo.updateObjective(done.id, { state: 'draft' });
              case 'launch':
                return repo.updateObjective(b.id, { state: 'launching' });
              case 'run-queue':
                return import('../packages/core/service/run-queue.ts').then(({ reorderRunQueue }) =>
                  reorderRunQueue(
                    db,
                    queue!.id,
                    queue!.entries
                      .filter(e => e.state === 'waiting' || e.state === 'blocked')
                      .map(e => e.id)
                      .reverse()
                  )
                );
            }
          };
          const outcomes = await Promise.allSettled([
            repo.reorderObjectives(mission.id, { orderedObjectiveIds: [c.id, b.id, a.id] }),
            competing()
          ]);
          for (const outcome of outcomes) {
            if (outcome.status === 'rejected') {
              assert.ok([400, 404, 409].includes(outcome.reason?.status), String(outcome.reason));
            }
          }
          assert.ok(outcomes.some(outcome => outcome.status === 'fulfilled'));
          assert.deepEqual(
            await db.get('SELECT position, revision FROM objectives WHERE id = ?', [active.id]),
            anchor
          );
          const rows = await db.all<{ position: number }>(
            'SELECT position FROM objectives WHERE mission_id = ? AND deleted_at IS NULL',
            [mission.id]
          );
          assert.equal(new Set(rows.map(row => row.position)).size, rows.length);
          assert.ok(rows.every(row => row.position >= 0 && row.position < 100));
          if (mutation !== 'reopen') {
            assert.equal(
              (await db.get<{ position: number }>('SELECT position FROM objectives WHERE id = ?', [
                done.id
              ]))!.position,
              40
            );
          }
        } finally {
          await cleanup();
        }
      });
    }
  });
}
