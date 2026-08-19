import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-webapp-auth-'));
process.env.OVERLORD_SQLITE_PATH = path.join(tempDir, 'webapp.sqlite');

const dbModule = await import('./db.ts');
const { db, initDatabase, setActiveWorkspaceUser } = dbModule;
await initDatabase();
const { ensureWorkspaceUser, resolveAuthorizedWorkspaces } = await import('./auth.ts');
const { DEFAULT_TEST_ORGANIZATION_ID, seedAuthenticatedOperator } =
  await import('./test-helpers.ts');
const { createWorkspace } = await import('./workspaces.ts');

const operatorWorkspaceUserId = seedAuthenticatedOperator({ db });
setActiveWorkspaceUser(operatorWorkspaceUserId);

function insertUnaffiliatedProfile(profileId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 1, NULL, ?, ?)`
  ).run(profileId, profileId, `${profileId}@overlord.local`, now, now);
}

test('ensureWorkspaceUser resolves an existing member without change', async () => {
  const membership = await ensureWorkspaceUser('operator-user');
  assert.equal(membership?.workspaceUserId, operatorWorkspaceUserId);
  assert.equal(membership?.workspace.id, 'local-workspace');
});

test('ensureWorkspaceUser does not auto-join a second signed-up account into any workspace', async () => {
  // Simulate a second workspace already existing, so we can prove the new
  // signup is not folded into *any* of them, not just the active one.
  await createWorkspace({
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    name: 'Second Workspace For Auth Test'
  });

  insertUnaffiliatedProfile('test-user');

  const membership = await ensureWorkspaceUser('test-user');
  assert.equal(membership, null, 'a non-member session must resolve to no active workspace');

  const memberships = db
    .prepare(
      `SELECT workspace_id FROM workspace_users
         WHERE profile_id = ? AND deleted_at IS NULL`
    )
    .all('test-user') as { workspace_id: string }[];
  assert.deepEqual(
    memberships,
    [],
    'a freshly signed-up account must not be a member of any existing workspace'
  );
});

test('ensureWorkspaceUser resolves a member without request transport', async () => {
  const second = await createWorkspace({
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    name: 'Explicit Request Workspace'
  });
  insertUnaffiliatedProfile('multi-workspace-user');
  db.prepare(
    `INSERT INTO workspace_users
       (id, workspace_id, profile_id, member_key, status, metadata_json, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, 'active', '{}', ?, ?, 1)`
  ).run(
    'multi-workspace-user-membership',
    second.id,
    'multi-workspace-user',
    'auth:multi-workspace-user',
    new Date().toISOString(),
    new Date().toISOString()
  );

  const membership = await ensureWorkspaceUser('multi-workspace-user');
  assert.equal(membership?.workspaceUserId, 'multi-workspace-user-membership');
  assert.equal(membership?.workspace.id, second.id);
});

test('ensureWorkspaceUser uses its compatibility membership without a request preference', async () => {
  const membership = await ensureWorkspaceUser('operator-user');
  assert.equal(membership?.workspace.id, 'local-workspace');
});

test('authorized workspace resolution batches every live membership in one organization', async () => {
  const workspace = await createWorkspace({
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    name: 'Authorized Context Workspace'
  });
  insertUnaffiliatedProfile('authorized-context-user');
  const now = new Date().toISOString();
  for (const [workspaceId, membershipId] of [
    ['local-workspace', 'authorized-context-local-member'],
    [workspace.id, 'authorized-context-secondary-member']
  ] as const) {
    db.prepare(
      `INSERT INTO workspace_users
         (id, workspace_id, profile_id, member_key, status, metadata_json, created_at, updated_at, revision)
       VALUES (?, ?, 'authorized-context-user', ?, 'active', '{}', ?, ?, 1)`
    ).run(membershipId, workspaceId, `auth:${membershipId}`, now, now);
    db.prepare(
      `INSERT INTO role_assignments
         (id, workspace_id, workspace_user_id, role_key, resource_type, resource_id,
          assigned_by_workspace_user_id, created_at, updated_at, revision)
       VALUES (?, ?, ?, 'MEMBER', '', '', ?, ?, ?, 1)`
    ).run(`role:${membershipId}`, workspaceId, membershipId, membershipId, now, now);
  }

  const authorized = await resolveAuthorizedWorkspaces('authorized-context-user', null);
  assert.equal(authorized.organizationId, DEFAULT_TEST_ORGANIZATION_ID);
  assert.deepEqual(
    authorized.workspaces
      .map(workspace => [workspace.workspaceId, workspace.workspaceUserId])
      .sort(([a], [b]) => a.localeCompare(b)),
    [
      ['local-workspace', 'authorized-context-local-member'],
      [workspace.id, 'authorized-context-secondary-member']
    ].sort(([a], [b]) => a.localeCompare(b))
  );
  assert.ok(authorized.workspaces.every(workspace => workspace.roleKeys.includes('MEMBER')));

  const explicitButEmpty = await resolveAuthorizedWorkspaces('authorized-context-user', {
    id: 'token-with-no-consent-rows',
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    allWorkspaces: false
  });
  assert.deepEqual(
    explicitButEmpty.workspaces,
    [],
    'an empty explicit token allowlist fails closed'
  );
});

test('a request with no active workspace cleanly 403s through requirePermission instead of throwing', async () => {
  const { withRequestContextAsync, setActiveWorkspaceContext } = dbModule;
  const { requirePermission } = await import('./rbac.ts');
  const { PERMISSIONS } = await import('@overlord/auth');

  await withRequestContextAsync(async () => {
    // Mirrors exactly what `requireAuthenticatedSession` sets for a browser
    // session with no active workspace membership (see `ensureWorkspaceUser`
    // returning `null`): the RBAC gate must reject with a clean 403, not crash,
    // even though `rbac.ts`'s default parameters would otherwise evaluate
    // `getActiveWorkspaceId()` (which throws in this state).
    setActiveWorkspaceContext(null);
    setActiveWorkspaceUser(null);

    await assert.rejects(
      () => requirePermission(PERMISSIONS.WORKSPACE_READ, { workspaceId: 'missing-workspace' }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as { status?: number }).status, 403);
        return true;
      }
    );
  });
});

test.after(async () => {
  rmSync(tempDir, { recursive: true, force: true });
});
