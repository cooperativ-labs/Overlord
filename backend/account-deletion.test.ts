import assert from 'node:assert/strict';
import test from 'node:test';

const { createIntegrationTestDb } = await import('./test-helpers.ts');
const { db, operatorWorkspaceUserId } = await createIntegrationTestDb('overlord-account-deletion-');

const dbModule = await import('./db.ts');
const { createTestWorkspaceContext } = await import('./test-helpers.ts');
const testWorkspaceContext = createTestWorkspaceContext(dbModule);
const { setActiveWorkspaceUser } = dbModule;
const { seedAuthenticatedOperator } = await import('./test-helpers.ts');
const { cascadeDeleteAccount } = await import('./account-deletion.ts');
const { createProject, createMission } = await import('./repository.ts');

function seedToken({
  id,
  profileId,
  workspaceUserId
}: {
  id: string;
  profileId: string;
  workspaceUserId: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_tokens (
       id, workspace_id, profile_id, workspace_user_id, label, token_prefix,
       token_hash, hash_algorithm, status, created_at, updated_at, revision
     ) VALUES (?, ?, ?, ?, 'Test token', ?, 'hash', 'sha256', 'active', ?, ?, 1)`
  ).run(id, testWorkspaceContext.WORKSPACE.id, profileId, workspaceUserId, id, now, now);
}

function seedImage({ id, profileId }: { id: string; profileId: string }): void {
  const now = new Date().toISOString();
  // Bucket id matches the convention `seedAuthenticatedOperator` (test-helpers.ts)
  // seeds with, now that the migration-seeded `local-storage-user-images` row no
  // longer exists on a fresh install (coo:135 no-seed cleanup, Q10).
  db.prepare(
    `INSERT INTO user_images (
       id, workspace_id, profile_id, storage_bucket_id, storage_key,
       filename, content_type, created_at, updated_at, revision
     ) VALUES (?, ?, ?, ?, ?, 'avatar.png', 'image/png', ?, ?, 1)`
  ).run(
    id,
    testWorkspaceContext.WORKSPACE.id,
    profileId,
    `${testWorkspaceContext.WORKSPACE.id}-user-images`,
    `${id}.png`,
    now,
    now
  );
}

test('cascadeDeleteAccount purges workspace membership, tokens, and images so the auth user row can be hard-deleted', async () => {
  const profileId = 'victim-user';
  const workspaceUserId = 'victim-workspace-user';
  seedAuthenticatedOperator({ db, profileId, workspaceUserId });
  seedToken({ id: 'victim-token', profileId, workspaceUserId });
  const project = await createProject({ name: 'Account erasure provenance' });
  const mission = await createMission({
    projectId: project.id,
    title: 'Imported before account erasure',
    firstObjective: 'Check provenance'
  });
  db.prepare(
    `UPDATE missions SET created_by_token_id = ?, created_by_token_label = ? WHERE id = ?`
  ).run('victim-token', 'Personal importer label', mission.id);
  db.prepare(`UPDATE user_tokens SET scope = 'mission_lifecycle' WHERE id = 'victim-token'`).run();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_token_scopes
    (id, workspace_id, token_id, permission, created_at, updated_at, revision)
    VALUES ('victim-token-scope', 'local-workspace', 'victim-token', 'mission:read', ?, ?, 1)`
  ).run(now, now);
  seedImage({ id: 'victim-image', profileId });

  // seedAuthenticatedOperator also grants an ADMIN role_assignment, which is
  // itself a RESTRICT child of workspace_users — exercise that path too.
  const roleAssignment = db
    .prepare(`SELECT id FROM role_assignments WHERE workspace_user_id = ?`)
    .get(workspaceUserId) as { id: string } | undefined;
  assert.ok(roleAssignment, 'expected seedAuthenticatedOperator to grant a role assignment');

  await cascadeDeleteAccount(profileId);

  const provenance = db
    .prepare(`SELECT created_by_token_id, created_by_token_label FROM missions WHERE id = ?`)
    .get(mission.id) as { created_by_token_id: string; created_by_token_label: string | null };
  assert.equal(provenance.created_by_token_id, 'victim-token');
  assert.equal(provenance.created_by_token_label, null);

  assert.equal(
    db.prepare(`SELECT id FROM workspace_users WHERE id = ?`).get(workspaceUserId),
    undefined,
    'expected the workspace membership to be purged'
  );
  assert.equal(
    db.prepare(`SELECT id FROM role_assignments WHERE workspace_user_id = ?`).get(workspaceUserId),
    undefined,
    'expected the role assignment to be purged'
  );
  assert.equal(
    db.prepare(`SELECT id FROM user_tokens WHERE id = ?`).get('victim-token'),
    undefined,
    'expected the token to be purged'
  );
  assert.equal(
    db.prepare(`SELECT id FROM user_token_scopes WHERE token_id = 'victim-token'`).get(),
    undefined
  );
  assert.equal(
    db.prepare(`SELECT id FROM user_images WHERE id = ?`).get('victim-image'),
    undefined,
    'expected the image to be purged'
  );

  // The RESTRICT children are cleared, so the auth user row — and its hard
  // cascade to profiles and user_execution_target_preferences — can proceed
  // without a foreign key violation, mirroring what Better Auth does right
  // after the beforeDelete hook returns.
  db.prepare(`DELETE FROM "user" WHERE id = ?`).run(profileId);

  const profile = db.prepare(`SELECT id FROM profiles WHERE id = ?`).get(profileId);
  assert.equal(profile, undefined, 'expected the profile row to be hard-cascaded away');
});

test('cascadeDeleteAccount is a no-op for an already-deleted profile', async () => {
  await assert.doesNotReject(cascadeDeleteAccount('no-such-profile'));
});

test('cascadeDeleteAccount does not attribute entity_changes to the membership it is deleting', async () => {
  // The `deleteUser` beforeDelete hook runs outside any request context, so
  // the ambient "active workspace user" can resolve to this very profile's
  // own membership — a real bug caught only by *not* pointing the ambient
  // actor at some other, untouched operator before deleting.
  const profileId = 'self-deleting-user';
  const workspaceUserId = 'self-deleting-workspace-user';
  seedAuthenticatedOperator({ db, profileId, workspaceUserId });
  setActiveWorkspaceUser(workspaceUserId);

  try {
    await assert.doesNotReject(cascadeDeleteAccount(profileId));
  } finally {
    setActiveWorkspaceUser(operatorWorkspaceUserId);
  }

  assert.equal(
    db.prepare(`SELECT id FROM workspace_users WHERE id = ?`).get(workspaceUserId),
    undefined,
    'expected the workspace membership to be purged'
  );
});
