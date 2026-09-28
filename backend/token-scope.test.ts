import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentMaxSeq,
  db,
  getActiveWorkspaceId,
  getActorWorkspaceUserId,
  initDatabase,
  recordChange,
  requireDatabaseClient,
  setActiveTokenAuth,
  setActiveWorkspace,
  setActiveWorkspaceUser
} from './db.ts';
import { ApiError } from './errors.ts';
import { actorCan, requirePermission, requireProjectPermission } from './rbac.ts';
import { readChangesAfter } from './realtime.ts';
import {
  createMission,
  createProject,
  createUserToken,
  deleteRevokedUserToken,
  listMissions,
  listProjects,
  listUserTokens,
  renameUserToken,
  revokeUserToken
} from './repository.ts';
import { seedAuthenticatedOperator } from './test-helpers.ts';

// These tests create an explicit ADMIN local operator. They exercise the real
// REST→service path for default expiry, scope persistence, and the unified RBAC
// gate that intersects role grants with token scope.

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
await initDatabase();
const operatorWorkspaceUserId = seedAuthenticatedOperator({ db });
// `seedAuthenticatedOperator` only inserts rows; the organizations migration's
// no-seed cleanup (coo:135, Q10) means a fresh database has zero workspaces
// until something activates one, so `getActiveWorkspaceId()` calls below need
// this explicit activation (previously implicit via the migration-seeded
// `local-workspace` row).
await setActiveWorkspace('local-workspace');
setActiveWorkspaceUser(operatorWorkspaceUserId);

function activeScope() {
  return { workspaceId: getActiveWorkspaceId(), workspaceUserId: getActorWorkspaceUserId() };
}

test('createUserToken defaults to a ~90-day expiry when none is given', async () => {
  const { token } = await createUserToken({ label: 'default-expiry' });
  assert.ok(token.expiresAt, 'expected a default expiry');
  const delta = new Date(token.expiresAt).getTime() - Date.now();
  // Allow a wide window for test execution time.
  assert.ok(delta > NINETY_DAYS_MS - 60_000 && delta < NINETY_DAYS_MS + 60_000);
  assert.equal(token.scope, 'full');
  assert.deepEqual(token.scopeGrants, []);
  // A token the user mints for themselves consents to their whole organization:
  // no narrowing allowlist, and `workspace_id` remains issuance attribution only.
  const consent = db
    .prepare(
      `SELECT t.organization_id, t.all_workspaces, t.workspace_id,
              (SELECT COUNT(*) FROM user_token_workspaces WHERE token_id = t.id) AS allowlist
         FROM user_tokens t
        WHERE t.id = ?`
    )
    .get(token.id) as {
    organization_id: string;
    all_workspaces: number;
    workspace_id: string;
    allowlist: number;
  };
  assert.deepEqual(consent, {
    organization_id: 'test-organization',
    all_workspaces: 1,
    workspace_id: 'local-workspace',
    allowlist: 0
  });
});

test('createUserToken honours an explicit null expiry (never expires)', async () => {
  const { token } = await createUserToken({ label: 'no-expiry', expiresAt: null });
  assert.equal(token.expiresAt, null);
});

test('createUserToken with mission_lifecycle scope persists grants and surfaces them', async () => {
  const { token } = await createUserToken({ label: 'runner', scope: 'mission_lifecycle' });
  assert.equal(token.scope, 'mission_lifecycle');
  assert.ok(token.scopeGrants.includes('mission:*'));
  assert.ok(token.scopeGrants.includes('execution_request:claim'));
  assert.ok(token.scopeGrants.includes('project:create'));
  assert.ok(!token.scopeGrants.includes('project:delete'));

  // The list endpoint reflects the same scope.
  const listed = (await listUserTokens()).find(t => t.id === token.id);
  assert.equal(listed?.scope, 'mission_lifecycle');
});

test('project automation issuance and reads are limited to selected projects in one workspace', async () => {
  const now = new Date().toISOString();
  const projectP = '11111111-1111-4111-8111-111111111111';
  const projectQ = '22222222-2222-4222-8222-222222222222';
  for (const [id, name] of [
    [projectP, 'Selected P'],
    [projectQ, 'Hidden Q']
  ]) {
    db.prepare(
      `INSERT OR IGNORE INTO projects
      (id, workspace_id, slug, name, description, status, settings_json, created_at, updated_at, revision)
      VALUES (?, 'local-workspace', ?, ?, NULL, 'active', '{}', ?, ?, 1)`
    ).run(id, id, name, now, now);
  }
  await assert.rejects(
    createUserToken({ label: 'missing projects', scope: 'project_automation' }),
    /Select one or more unique project IDs/
  );
  await assert.rejects(
    createUserToken({ label: 'unexpected projects', scope: 'full', projectIds: [projectP] }),
    /only available for project automation/
  );
  const { token } = await createUserToken({
    label: 'P importer',
    scope: 'project_automation',
    projectIds: [projectP]
  });
  assert.deepEqual(token.projects, [{ id: projectP, name: 'Selected P' }]);
  const persisted = db
    .prepare(`SELECT scope, all_workspaces FROM user_tokens WHERE id = ?`)
    .get(token.id) as { scope: string; all_workspaces: number };
  assert.deepEqual(persisted, { scope: 'project_automation', all_workspaces: 0 });
  const consent = db
    .prepare(`SELECT workspace_id FROM user_token_workspaces WHERE token_id = ?`)
    .all(token.id);
  assert.deepEqual(consent, [{ workspace_id: 'local-workspace' }]);
  const otherWorkspace = 'automation-other-workspace';
  const otherProject = '33333333-3333-4333-8333-333333333333';
  db.prepare(
    `INSERT OR IGNORE INTO workspaces
    (id, organization_id, slug, name, kind, settings_json, created_at, updated_at, revision)
    VALUES (?, 'test-organization', ?, ?, 'local', '{}', ?, ?, 1)`
  ).run(otherWorkspace, otherWorkspace, otherWorkspace, now, now);
  db.prepare(
    `INSERT OR IGNORE INTO projects
    (id, workspace_id, slug, name, description, status, settings_json, created_at, updated_at, revision)
    VALUES (?, ?, ?, 'Other workspace project', NULL, 'active', '{}', ?, ?, 1)`
  ).run(otherProject, otherWorkspace, otherProject, now, now);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO user_token_projects (token_id, project_id, created_at)
    VALUES (?, ?, ?)`
        )
        .run(token.id, otherProject, now),
    /consented workspace/
  );
  const beforeChanges = await currentMaxSeq(requireDatabaseClient());
  await recordChange({
    entityType: 'project',
    entityId: projectQ,
    operation: 'update',
    workspaceId: 'local-workspace',
    projectId: projectQ
  });
  await recordChange({
    entityType: 'project',
    entityId: projectP,
    operation: 'update',
    workspaceId: 'local-workspace',
    projectId: projectP
  });
  setActiveTokenAuth({
    workspaceUserId: operatorWorkspaceUserId,
    tokenId: token.id,
    scopeGrants: token.scopeGrants,
    projectIds: [projectP]
  });
  try {
    assert.deepEqual(
      (await listProjects()).map(project => project.id),
      [projectP]
    );
    const changes = await readChangesAfter(beforeChanges, ['local-workspace'], 1);
    assert.deepEqual(
      changes.changes.map(change => change.projectId),
      [projectP]
    );
    assert.equal(changes.hasMore, false);
    await requireProjectPermission({ projectId: projectP, permission: 'project:read' });
    await assert.rejects(
      requireProjectPermission({ projectId: projectQ, permission: 'project:read' }),
      (error: unknown) => error instanceof ApiError && error.status === 404
    );
  } finally {
    setActiveWorkspaceUser(operatorWorkspaceUserId);
  }
  db.prepare(`DELETE FROM user_token_scopes WHERE token_id = ?`).run(token.id);
  try {
    db.prepare(`DELETE FROM user_tokens WHERE id = ?`).run(token.id);
  } catch (error) {
    throw new Error(`Hard deletion failed: ${String(error)}`, { cause: error });
  }
  const remaining = db
    .prepare(`SELECT COUNT(*) AS count FROM user_token_projects WHERE token_id = ?`)
    .get(token.id) as { count: number };
  assert.equal(remaining.count, 0);
});

test('a revoked token can be deleted from the owner token list', async () => {
  const { token } = await createUserToken({ label: 'remove revoked token' });
  await revokeUserToken(token.id);
  await deleteRevokedUserToken(token.id);

  assert.equal(
    (await listUserTokens()).some(candidate => candidate.id === token.id),
    false,
    'the revoked token is soft-deleted and no longer listed'
  );
  const row = db.prepare('SELECT deleted_at FROM user_tokens WHERE id = ?').get(token.id);
  assert.ok(
    row && (row as { deleted_at: string | null }).deleted_at,
    'the audit row remains tombstoned'
  );
});

test('mission creator token attribution snapshots labels and survives revoke and soft-delete', async () => {
  setActiveWorkspaceUser(operatorWorkspaceUserId);
  const project = await createProject({ name: 'Token attribution' });
  const { token } = await createUserToken({
    label: 'Importer v1',
    scope: 'project_automation',
    projectIds: [project.id]
  });
  const createAsToken = async (title: string) => {
    setActiveTokenAuth({
      workspaceUserId: operatorWorkspaceUserId,
      tokenId: token.id,
      scopeGrants: token.scopeGrants,
      projectIds: [project.id]
    });
    try {
      return await createMission({ projectId: project.id, title, firstObjective: 'File feedback' });
    } finally {
      setActiveWorkspaceUser(operatorWorkspaceUserId);
    }
  };

  const first = await createAsToken('First feedback');
  assert.deepEqual(first.createdByToken, { tokenId: token.id, label: 'Importer v1' });
  assert.equal(first.assignedWorkspaceUserId, null);
  assert.equal(first.createdByKind, 'human');

  await renameUserToken(token.id, { label: 'Importer v2' });
  const second = await createAsToken('Second feedback');
  assert.deepEqual(second.createdByToken, { tokenId: token.id, label: 'Importer v2' });

  await revokeUserToken(token.id);
  await deleteRevokedUserToken(token.id);
  const rows = await listMissions(project.id);
  assert.deepEqual(rows.find(row => row.id === first.id)?.createdByToken, {
    tokenId: token.id,
    label: 'Importer v1'
  });
  assert.deepEqual(rows.find(row => row.id === second.id)?.createdByToken, {
    tokenId: token.id,
    label: 'Importer v2'
  });
});

test('an active token cannot be deleted without first being revoked', async () => {
  const { token } = await createUserToken({ label: 'active token' });
  await assert.rejects(deleteRevokedUserToken(token.id), /Only revoked tokens can be deleted/);
});

test('a mission_lifecycle token is denied admin/destructive actions but allowed mission/runner work', async () => {
  const scopeGrants = [
    'project:read',
    'project:create',
    'mission:*',
    'objective:*',
    'session:*',
    'event:create',
    'event:read',
    'artifact:*',
    'attachment:*',
    'execution_request:create',
    'execution_request:read',
    'execution_request:claim'
  ];
  setActiveTokenAuth({
    workspaceUserId: operatorWorkspaceUserId,
    tokenId: 'tok-test',
    scopeGrants
  });

  assert.equal(await actorCan('mission:create', activeScope()), true);
  assert.equal(await actorCan('objective:update', activeScope()), true);
  assert.equal(await actorCan('execution_request:claim', activeScope()), true);
  assert.equal(await actorCan('project:create', activeScope()), true);
  assert.equal(await actorCan('project:update', activeScope()), false);
  assert.equal(await actorCan('project:delete', activeScope()), false);
  assert.equal(await actorCan('user:create', activeScope()), false);
  assert.equal(await actorCan('user_token:self:create', activeScope()), false);

  await assert.rejects(requirePermission('project:delete', activeScope()), ApiError);
  await requirePermission('mission:create', activeScope());
});

test('a full token (session/loopback) keeps the operator ADMIN permissions', async () => {
  setActiveWorkspaceUser(operatorWorkspaceUserId);
  assert.equal(await actorCan('project:delete', activeScope()), true);
  assert.equal(await actorCan('user:create', activeScope()), true);
});
