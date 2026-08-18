import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-github-project-initialization-'));
const { bootstrapIntegrationTestDb } = await import('../../test-helpers.ts');
const { db } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'github-project-initialization.sqlite')
});
const { getActiveWorkspaceId, newId, nowIso, requireDatabaseClient } = await import('../../db.ts');
const {
  createProjectInitialization,
  readProjectInitialization,
  readProjectInitializationById,
  recordPrivateRepositoryLink,
  recordProvisioningFailure,
  recordProvisioningSuccess
} = await import('./service.ts');

const profileId = 'operator-user';
const workspaceId = getActiveWorkspaceId();
const now = nowIso();

async function ensureProfile(): Promise<void> {
  await requireDatabaseClient().run(
    `INSERT OR IGNORE INTO profiles (id, kind, display_name, status, created_at, updated_at, revision)
     VALUES (?, 'human', ?, 'active', ?, ?, 1)`,
    [profileId, profileId, now, now]
  );
}

async function seedProjectAndMission(): Promise<{ projectId: string; missionId: string }> {
  await ensureProfile();
  const projectId = newId();
  const missionId = newId();
  const slug = `init-test-${projectId.slice(0, 8)}`;
  const db = requireDatabaseClient();
  const sequenceRow = (await db.get(
    `SELECT COALESCE(MAX(sequence_number), 0) AS max_sequence FROM missions WHERE workspace_id = ?`,
    [workspaceId]
  )) as { max_sequence: number };
  const sequenceNumber = sequenceRow.max_sequence + 1;
  const positionRow = (await db.get(
    `SELECT COALESCE(MAX(position), 0) AS max_position FROM projects WHERE workspace_id = ?`,
    [workspaceId]
  )) as { max_position: number };
  const position = positionRow.max_position + 1;
  await db.run(
    `INSERT INTO projects (id, workspace_id, slug, name, description, status, settings_json,
        created_by_workspace_user_id, created_at, updated_at, revision, position)
     VALUES (?, ?, ?, ?, ?, 'active', '{}', 'operator-workspace-user', ?, ?, 1, ?)`,
    [projectId, workspaceId, slug, 'Init Test', 'desc', now, now, position]
  );
  await db.run(
    `INSERT INTO missions (id, workspace_id, project_id, display_id, sequence_number, title,
        status_id, status_type, board_position, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, 1)`,
    [
      missionId,
      workspaceId,
      projectId,
      `${slug}:1`,
      sequenceNumber,
      'Init Test',
      `${workspaceId}-backlog`,
      now,
      now
    ]
  );
  return { projectId, missionId };
}

test.after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test('createProjectInitialization inserts and readProjectInitialization reads by idempotency key', async () => {
  const { projectId, missionId } = await seedProjectAndMission();
  const initializationId = newId();
  const idempotencyKey = 'github-init-read-test';

  const created = await requireDatabaseClient().transaction(async tx => {
    return createProjectInitialization(tx, {
      id: initializationId,
      profileId,
      workspaceId,
      projectId,
      missionId,
      idempotencyKey,
      ownerLogin: 'octocat',
      status: 'pending',
      now
    });
  });

  assert.equal(created.id, initializationId);
  assert.equal(created.provisioning_status, 'pending');
  assert.equal(created.github_owner_login, 'octocat');

  const read = await readProjectInitialization(requireDatabaseClient(), profileId, idempotencyKey);
  assert.deepEqual(read, created);

  const readById = await readProjectInitializationById(requireDatabaseClient(), initializationId);
  assert.deepEqual(readById, created);
});

test('recordProvisioningFailure updates a pending initialization to failed', async () => {
  const { projectId, missionId } = await seedProjectAndMission();
  const initializationId = newId();
  const idempotencyKey = 'github-init-failure-test';

  await requireDatabaseClient().transaction(async tx => {
    await createProjectInitialization(tx, {
      id: initializationId,
      profileId,
      workspaceId,
      projectId,
      missionId,
      idempotencyKey,
      ownerLogin: 'octocat',
      status: 'pending',
      now
    });
    await recordProvisioningFailure(tx, {
      id: initializationId,
      message: 'GitHub repository provisioning failed.',
      now
    });
  });

  const read = await readProjectInitializationById(requireDatabaseClient(), initializationId);
  assert.equal(read?.provisioning_status, 'failed');
  assert.equal(read?.failure_message, 'GitHub repository provisioning failed.');
  assert.equal(read?.revision, 2);
});

test('recordPrivateRepositoryLink and recordProvisioningSuccess persist link and success state', async () => {
  const { projectId, missionId } = await seedProjectAndMission();
  const initializationId = newId();
  const idempotencyKey = 'github-init-success-test';
  const repo = {
    id: '9876',
    fullName: 'octocat/private-repo',
    defaultBranch: 'main',
    private: true,
    cloneUrl: 'https://github.com/octocat/private-repo.git'
  };

  await requireDatabaseClient().transaction(async tx => {
    await createProjectInitialization(tx, {
      id: initializationId,
      profileId,
      workspaceId,
      projectId,
      missionId,
      idempotencyKey,
      ownerLogin: 'octocat',
      status: 'pending',
      now
    });
    await recordPrivateRepositoryLink(tx, {
      project: { id: projectId, workspaceId },
      repo,
      now
    });
    await recordProvisioningSuccess(tx, { id: initializationId, repo, now });
  });

  const read = await readProjectInitializationById(requireDatabaseClient(), initializationId);
  assert.equal(read?.provisioning_status, 'succeeded');
  assert.equal(read?.github_repo_id, repo.id);
  assert.equal(read?.full_name, repo.fullName);
  assert.equal(read?.clone_url, repo.cloneUrl);
  assert.equal(read?.failure_message, null);

  const link = db
    .prepare(
      `SELECT github_repo_id, full_name FROM ext_github_project_links
        WHERE project_id = ? AND deleted_at IS NULL`
    )
    .get(projectId) as { github_repo_id: string; full_name: string } | undefined;
  assert.equal(link?.github_repo_id, repo.id);
  assert.equal(link?.full_name, repo.fullName);

  await requireDatabaseClient().transaction(async tx => {
    await recordPrivateRepositoryLink(tx, {
      project: { id: projectId, workspaceId },
      repo,
      now
    });
  });
  const linkCount = db
    .prepare(
      `SELECT COUNT(*) AS count FROM ext_github_project_links
        WHERE project_id = ? AND deleted_at IS NULL`
    )
    .get(projectId) as { count: number };
  assert.equal(linkCount.count, 1);
});
