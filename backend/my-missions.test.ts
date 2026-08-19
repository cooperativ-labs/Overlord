import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-webapp-my-missions-'));
const { bootstrapIntegrationTestDb, DEFAULT_TEST_ORGANIZATION_ID } =
  await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const {
  db,
  setActiveProfileId,
  setAuthorizedWorkspacesContext,
  setActiveWorkspaceContext,
  setActiveWorkspaceUser,
  nowIso,
  withRequestContextAsync
} = await import('./db.ts');
const {
  createProject,
  createMission,
  createProjectStatus,
  updateMission,
  deleteMission,
  deleteProjectStatus,
  listMissions,
  listProjectStatuses,
  listWorkspaceMyMissions,
  reorderWorkspaceMyMissions
} = await import('./repository.ts');
const { ApiError } = await import('./errors.ts');

// Operator is seeded by bootstrapIntegrationTestDb.
const operatorId = 'operator-workspace-user';

async function statusFor(projectId: string, key: string) {
  const status = (await listProjectStatuses(projectId)).find(item => item.key === key);
  assert.ok(status, `expected ${key} status for project ${projectId}`);
  return status;
}

test('the test database seeds the active operator workspace user', async () => {
  const row = db.prepare(`SELECT status FROM workspace_users WHERE id = ?`).get(operatorId) as
    | { status: string }
    | undefined;
  assert.ok(row, 'bootstrap should seed the operator workspace user');
  assert.equal(row.status, 'active', 'the seeded operator must be active');
});

test('lists missions assigned to the operator across projects, with project context', async () => {
  const projectA = await createProject({ name: 'MT Project A', color: '#112233' });
  const projectB = await createProject({ name: 'MT Project B' });
  const a1 = await createMission({ projectId: projectA.id, firstObjective: 'A1' });
  const b1 = await createMission({ projectId: projectB.id, firstObjective: 'B1' });
  const unassigned = await createMission({ projectId: projectA.id, firstObjective: 'U' });
  await updateMission(unassigned.id, { assignedWorkspaceUserId: null });
  const deleted = await createMission({ projectId: projectA.id, firstObjective: 'D' });
  await deleteMission(deleted.id);

  const ids = (await listWorkspaceMyMissions()).missions.map(t => t.id);
  assert.ok(ids.includes(a1.id));
  assert.ok(ids.includes(b1.id));
  assert.ok(!ids.includes(unassigned.id), 'unassigned mission must be excluded');
  assert.ok(!ids.includes(deleted.id), 'deleted mission must be excluded');

  const a1Dto = (await listWorkspaceMyMissions()).missions.find(t => t.id === a1.id)!;
  assert.equal(a1Dto.projectName, 'MT Project A');
  assert.equal(a1Dto.projectColor, '#112233');
  assert.equal(a1Dto.myPosition, null);
});

test('within-column reorder writes personal position and leaves board_position untouched', async () => {
  const project = await createProject({ name: 'MT Reorder' });
  const nextUp = await statusFor(project.id, 'next_up');
  const t1 = await createMission({ projectId: project.id, firstObjective: 'r1' });
  const t2 = await createMission({ projectId: project.id, firstObjective: 'r2' });
  await updateMission(t1.id, { statusId: nextUp.id });
  await updateMission(t2.id, { statusId: nextUp.id });
  const beforeBoard = new Map((await listMissions(project.id)).map(t => [t.id, t.boardPosition]));

  // Put t2 above t1 in the Next column.
  await reorderWorkspaceMyMissions({ statusType: 'next', orderedMissionIds: [t2.id, t1.id] });

  const afterBoard = new Map((await listMissions(project.id)).map(t => [t.id, t.boardPosition]));
  assert.equal(afterBoard.get(t1.id), beforeBoard.get(t1.id), 'board_position must not change');
  assert.equal(afterBoard.get(t2.id), beforeBoard.get(t2.id), 'board_position must not change');

  const missions = (await listWorkspaceMyMissions()).missions;
  assert.equal(missions.find(t => t.id === t2.id)!.myPosition, 100);
  assert.equal(missions.find(t => t.id === t1.id)!.myPosition, 200);
  const order = missions.filter(t => t.id === t1.id || t.id === t2.id).map(t => t.id);
  assert.deepEqual(order, [t2.id, t1.id], 'positioned missions sort by personal position');
});

test('cross-column drag changes the mission status, type, and board_position', async () => {
  const project = await createProject({ name: 'MT CrossCol' });
  const backlog = await statusFor(project.id, 'backlog');
  const inProgress = await statusFor(project.id, 'in_progress');
  const mission = await createMission({ projectId: project.id, firstObjective: 'x' });
  assert.equal(
    (await listMissions(project.id)).find(t => t.id === mission.id)!.statusId,
    backlog.id
  );

  await reorderWorkspaceMyMissions({ statusType: 'execute', orderedMissionIds: [mission.id] });

  const after = (await listMissions(project.id)).find(t => t.id === mission.id)!;
  assert.equal(after.statusId, inProgress.id);
  assert.equal(after.statusType, 'execute');
  assert.equal(after.boardPosition, 100, 'board_position resets to top-of-new-column');

  const moved = (await listWorkspaceMyMissions()).missions.find(t => t.id === mission.id)!;
  assert.equal(moved.statusId, inProgress.id);
  assert.equal(moved.myPosition, 100);
});

test('a personal position is ignored once the mission leaves that column via another surface', async () => {
  const project = await createProject({ name: 'MT Stale' });
  const inProgress = await statusFor(project.id, 'in_progress');
  const mission = await createMission({ projectId: project.id, firstObjective: 's' });
  const nextUp = await statusFor(project.id, 'next_up');
  await reorderWorkspaceMyMissions({ statusType: 'next', orderedMissionIds: [mission.id] });
  assert.equal(
    (await listMissions(project.id)).find(t => t.id === mission.id)!.statusId,
    nextUp.id
  );
  // Move it via the project-board status-change path; the stored position keeps
  // its old status_id and must no longer apply.
  await updateMission(mission.id, { statusId: inProgress.id });

  const moved = (await listWorkspaceMyMissions()).missions.find(t => t.id === mission.id)!;
  assert.equal(moved.statusId, inProgress.id);
  assert.equal(moved.myPosition, null, 'stale position is ignored at read time');
});

test('reorder into a column type the project lacks is rejected with a typed code', async () => {
  const project = await createProject({ name: 'MT Reject' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'rej' });
  // `execute` and `review` are required per project, but a `complete` status can
  // be removed, leaving a project that cannot represent the Completed column.
  const done = await statusFor(project.id, 'done');
  await deleteProjectStatus(project.id, done.id);

  await assert.rejects(
    reorderWorkspaceMyMissions({ statusType: 'complete', orderedMissionIds: [mission.id] }),
    (err: unknown) =>
      err instanceof ApiError &&
      err.status === 409 &&
      err.code === 'STATUS_UNAVAILABLE_FOR_WORKSPACE'
  );
  // Nothing was persisted: the mission is still in its original status.
  assert.equal(
    (await listWorkspaceMyMissions()).missions.find(t => t.id === mission.id)!.statusType,
    'draft'
  );
});

test('an unknown column type is rejected before any write', async () => {
  const project = await createProject({ name: 'MT BadType' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'bad' });
  await assert.rejects(
    reorderWorkspaceMyMissions({
      statusType: 'blocked' as never,
      orderedMissionIds: [mission.id]
    }),
    (err: unknown) => err instanceof ApiError && err.status === 400
  );
});

test('one reorder call moves and interleaves missions across projects', async () => {
  const projectA = await createProject({ name: 'MT Cross A' });
  const projectB = await createProject({ name: 'MT Cross B' });
  const a1 = await createMission({ projectId: projectA.id, firstObjective: 'ca1' });
  const b1 = await createMission({ projectId: projectB.id, firstObjective: 'cb1' });
  const a2 = await createMission({ projectId: projectA.id, firstObjective: 'ca2' });

  await reorderWorkspaceMyMissions({
    statusType: 'execute',
    orderedMissionIds: [b1.id, a1.id, a2.id]
  });

  // Each mission resolved to the `execute` status of its *own* project.
  assert.equal(
    (await listMissions(projectA.id)).find(t => t.id === a1.id)!.statusId,
    (await statusFor(projectA.id, 'in_progress')).id
  );
  assert.equal(
    (await listMissions(projectB.id)).find(t => t.id === b1.id)!.statusId,
    (await statusFor(projectB.id, 'in_progress')).id
  );

  // Personal positions span the whole column, so the interleaved order survives.
  const executing = (await listWorkspaceMyMissions()).missions
    .filter(t => [a1.id, a2.id, b1.id].includes(t.id))
    .map(t => t.id);
  assert.deepEqual(executing, [b1.id, a1.id, a2.id]);
});

test('a mission already in the column type keeps its project-specific status', async () => {
  const project = await createProject({ name: 'MT KeepCustom' });
  // A project may define several `complete`-type statuses; the seeded "Done"
  // sorts first, so a mission parked in the custom one proves the drag does not
  // collapse it onto whichever status the column would otherwise resolve to.
  const custom = await createProjectStatus(project.id, { name: 'Shipped', type: 'complete' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'kc' });
  await updateMission(mission.id, { statusId: custom.id });

  await reorderWorkspaceMyMissions({ statusType: 'complete', orderedMissionIds: [mission.id] });

  const after = (await listWorkspaceMyMissions()).missions.find(t => t.id === mission.id)!;
  assert.equal(after.statusId, custom.id, 'the custom complete status is preserved');
  assert.equal(after.myPosition, 100);
});

test('excludes missions whose project has been deleted', async () => {
  const project = await createProject({ name: 'MT DeletedProj' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'dp' });
  assert.ok((await listWorkspaceMyMissions()).missions.some(t => t.id === mission.id));

  db.prepare(`UPDATE projects SET deleted_at = ? WHERE id = ?`).run(nowIso(), project.id);
  assert.ok(
    !(await listWorkspaceMyMissions()).missions.some(t => t.id === mission.id),
    'a mission in a deleted project must be excluded'
  );
});

test('a personal position survives reassignment and is restored when the mission returns', async () => {
  const project = await createProject({ name: 'MT Reassign' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'ra' });
  await reorderWorkspaceMyMissions({ statusType: 'next', orderedMissionIds: [mission.id] });

  await updateMission(mission.id, { assignedWorkspaceUserId: null });
  assert.ok(!(await listWorkspaceMyMissions()).missions.some(t => t.id === mission.id));

  await updateMission(mission.id, { assignedWorkspaceUserId: operatorId });
  const restored = (await listWorkspaceMyMissions()).missions.find(t => t.id === mission.id)!;
  assert.equal(restored.myPosition, 100, 'the personal position row persists across reassignment');
});

test('reorder rejects a mission not assigned to the operator', async () => {
  const project = await createProject({ name: 'MT NotMine' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'nm' });
  await updateMission(mission.id, { assignedWorkspaceUserId: null });
  await assert.rejects(
    reorderWorkspaceMyMissions({ statusType: 'next', orderedMissionIds: [mission.id] }),
    (err: unknown) => err instanceof ApiError && err.status === 403
  );
});

test('different tenants only see their own My Missions entries', async () => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 1, NULL, ?, ?)`
  ).run('tenant-b-user', 'tenant-b-user', 'tenant-b@overlord.local', now, now);
  db.prepare(
    `INSERT INTO workspaces
       (id, organization_id, slug, name, kind, settings_json, created_at, updated_at, revision)
     VALUES ('tenant-b', ?, 'tenant-b', 'Tenant B', 'local', '{}', ?, ?, 1)`
  ).run(DEFAULT_TEST_ORGANIZATION_ID, now, now);
  db.prepare(
    `INSERT INTO workspace_users
       (id, workspace_id, profile_id, member_key, status, metadata_json, created_at, updated_at, revision)
     VALUES (?, 'tenant-b', 'tenant-b-user', 'auth:tenant-b-user', 'active', '{}', ?, ?, 1)`
  ).run('tenant-b-workspace-user', now, now);
  db.prepare(
    `INSERT INTO role_assignments
       (id, workspace_id, workspace_user_id, role_key, resource_type, resource_id,
        assigned_by_workspace_user_id, created_at, updated_at, revision)
     VALUES (?, 'tenant-b', 'tenant-b-workspace-user', 'ADMIN', '', '', ?, ?, ?, 1)`
  ).run('tenant-b-admin-role', 'tenant-b-workspace-user', now, now);
  const operatorProject = await createProject({ name: 'Tenant A Project' });
  const operatorMission = await createMission({
    projectId: operatorProject.id,
    firstObjective: 'tenant-a-objective'
  });

  const tenantBWorkspace = { id: 'tenant-b', slug: 'tenant-b', name: 'Tenant B', kind: 'local' };
  const tenantBMissionId = await withRequestContextAsync(async () => {
    setActiveProfileId('tenant-b-user');
    setActiveWorkspaceContext(tenantBWorkspace);
    setActiveWorkspaceUser('tenant-b-workspace-user');
    setAuthorizedWorkspacesContext({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      workspaces: [
        {
          workspaceId: 'tenant-b',
          workspaceUserId: 'tenant-b-workspace-user',
          roleKeys: ['ADMIN'],
          workspace: tenantBWorkspace
        }
      ]
    });

    const tenantBProject = await createProject({
      name: 'Tenant B Project',
      workspaceId: 'tenant-b'
    });
    const tenantBMission = await createMission({
      projectId: tenantBProject.id,
      firstObjective: 'tenant-b-objective'
    });

    const visibleIds = (await listWorkspaceMyMissions()).missions.map(mission => mission.id);
    assert.ok(visibleIds.includes(tenantBMission.id));
    assert.ok(!visibleIds.includes(operatorMission.id));
    return tenantBMission.id;
  });

  const operatorVisibleIds = (await listWorkspaceMyMissions()).missions.map(mission => mission.id);
  assert.ok(operatorVisibleIds.includes(operatorMission.id));
  assert.ok(!operatorVisibleIds.includes(tenantBMissionId));
});

test.after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});
