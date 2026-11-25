import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(
  path.join(process.env.OVERLORD_TMPDIR || '/private/tmp', 'mission-previous-status-')
);
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'test.sqlite') });
const {
  createProject,
  createMission,
  createProjectStatus,
  listMissions,
  listProjectStatuses,
  updateMission
} = await import('./repository.ts');

test('completion retains the prior status in list and detail, and reopening clears it', async () => {
  const project = await createProject({ name: 'Previous status' });
  const statuses = await listProjectStatuses(project.id);
  const done = statuses.find(status => status.type === 'complete');
  const execute = statuses.find(status => status.type === 'execute');
  assert.ok(done && execute);
  const mission = await createMission({ projectId: project.id, firstObjective: 'Work' });
  await updateMission(mission.id, { statusId: execute.id });
  const completed = await updateMission(mission.id, { statusId: done.id });
  assert.equal(completed.previousStatusId, execute.id);
  assert.equal(
    (await listMissions(project.id)).find(item => item.id === mission.id)?.previousStatusId,
    execute.id
  );
  assert.equal(
    (await updateMission(mission.id, { title: 'Still complete' })).previousStatusId,
    execute.id
  );
  const reopened = await updateMission(mission.id, { statusId: execute.id });
  assert.equal(reopened.previousStatusId, null);
  assert.equal(
    (await updateMission(mission.id, { statusId: done.id })).previousStatusId,
    execute.id
  );
});

test('switching complete columns retains the preceding status and moving projects clears it', async () => {
  const source = await createProject({ name: 'Previous status source' });
  const target = await createProject({ name: 'Previous status target' });
  const statuses = await listProjectStatuses(source.id);
  const done = statuses.find(status => status.type === 'complete');
  assert.ok(done);
  const secondDone = await createProjectStatus(source.id, { name: 'Archived', type: 'complete' });
  const mission = await createMission({ projectId: source.id, firstObjective: 'Work' });
  const first = await updateMission(mission.id, { statusId: done.id });
  assert.equal(first.previousStatusId, mission.statusId);
  const second = await updateMission(mission.id, { statusId: secondDone.id });
  assert.equal(second.previousStatusId, mission.statusId);
  const moved = await updateMission(mission.id, { projectId: target.id });
  assert.equal(moved.previousStatusId, null);
});
