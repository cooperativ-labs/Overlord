import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'overlord-project-statuses-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const {
  createMission,
  createProject,
  createProjectStatus,
  deleteProjectStatus,
  listMissions,
  listProjectStatuses,
  listWorkspaceProjectStatuses,
  reorderBoardColumn,
  reorderProjectStatuses,
  reorderWorkspaceMyMissions,
  updateMission,
  updateProjectStatus
} = await import('./repository.ts');

test('project status CRUD is independent per project and preserves required guards', async () => {
  const project = await createProject({ name: 'Status CRUD' });
  const original = await listProjectStatuses(project.id);
  assert.equal(original.filter(status => status.type === 'next').length, 1);
  assert.equal(original.find(status => status.type === 'next')?.key, 'next_up');
  const created = await createProjectStatus(project.id, { name: 'Ready for QA', type: 'draft' });
  assert.equal(created.projectId, project.id);

  const renamed = await updateProjectStatus(project.id, created.id, { name: 'QA Ready' });
  assert.equal(renamed.name, 'QA Ready');

  const reordered = await reorderProjectStatuses(project.id, {
    orderedStatusIds: [created.id, ...original.map(status => status.id)]
  });
  assert.equal(reordered[0]?.id, created.id);

  const defaultStatus = reordered.find(status => status.isDefault)!;
  await assert.rejects(
    deleteProjectStatus(project.id, defaultStatus.id),
    (error: unknown) => (error as { status?: number }).status === 409
  );

  await deleteProjectStatus(project.id, created.id);
  assert.ok(!(await listProjectStatuses(project.id)).some(status => status.id === created.id));
});

test('next is a project-local singleton status type', async () => {
  const project = await createProject({ name: 'Next singleton' });

  await assert.rejects(
    createProjectStatus(project.id, { name: 'Queued soon', type: 'next' }),
    (error: unknown) => (error as { status?: number }).status === 409
  );
});

test('a next status can become the project default', async () => {
  const project = await createProject({ name: 'Next default' });
  const statuses = await listProjectStatuses(project.id);
  const next = statuses.find(status => status.type === 'next')!;
  const previousDefault = statuses.find(status => status.isDefault)!;

  const updated = await updateProjectStatus(project.id, next.id, { isDefault: true });

  assert.equal(updated.isDefault, true);
  const persisted = await listProjectStatuses(project.id);
  assert.equal(persisted.find(status => status.isDefault)?.id, next.id);
  assert.equal(persisted.find(status => status.id === previousDefault.id)?.isDefault, false);
});

test('status-id writes reject a sibling project status while the aggregate retains project ids', async () => {
  const projectA = await createProject({ name: 'Status Writer A' });
  const projectB = await createProject({ name: 'Status Writer B' });
  const mission = await createMission({
    projectId: projectA.id,
    firstObjective: 'Keep status local'
  });
  const foreign = (await listProjectStatuses(projectB.id)).find(
    status => status.type === 'execute'
  )!;

  await assert.rejects(
    updateMission(mission.id, { statusId: foreign.id }),
    (error: unknown) => (error as { status?: number }).status === 409
  );
  await assert.rejects(
    reorderBoardColumn(projectA.id, { statusId: foreign.id, orderedMissionIds: [mission.id] }),
    (error: unknown) => (error as { status?: number }).status === 409
  );
  // My Missions reorders by status *type*, so it can never name a sibling
  // project's status: it resolves the target inside the mission's own project.
  await reorderWorkspaceMyMissions({ statusType: 'execute', orderedMissionIds: [mission.id] });
  const own = (await listProjectStatuses(projectA.id)).find(status => status.type === 'execute')!;
  assert.equal(
    (await listMissions(projectA.id)).find(item => item.id === mission.id)!.statusId,
    own.id
  );

  const aggregate = await listWorkspaceProjectStatuses(projectA.workspaceId);
  assert.ok(aggregate.some(status => status.id === foreign.id && status.projectId === projectB.id));
});
