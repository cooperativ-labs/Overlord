import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listenForTest, routerTestApp } from '../../http/test-app-fixture.ts';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-github-routes-'));
const { bootstrapIntegrationTestDb, DEFAULT_TEST_ORGANIZATION_ID } =
  await import('../../test-helpers.ts');
const { WORKSPACE } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'github-routes.sqlite')
});

const workspaceAId = WORKSPACE.id;
const {
  getActorWorkspaceUserId,
  requireDatabaseClient,
  setActiveWorkspace,
  setActiveWorkspaceUser
} = await import('../../db.ts');
const { createProject } = await import('../../repository.ts');
const { createWorkspace } = await import('../../workspaces.ts');
const { createGitHubExtensionRouter } = await import('./routes.ts');

const workspaceAActorId = getActorWorkspaceUserId();

async function withGitHubServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const { profileConnections } = await import('../../connections/profile.ts');
  const { requireDatabaseClient } = await import('../../db.ts');
  const { githubConnectionProvider } = await import('./connection-provider.ts');
  const profiles = profileConnections(requireDatabaseClient(), [githubConnectionProvider()]);
  const app = routerTestApp((app, handle) => {
    app.use('/ext/github', createGitHubExtensionRouter(handle, { connections: () => profiles }));
  });

  const server = await listenForTest(app);
  try {
    await run(server.baseUrl);
  } finally {
    await server.close();
  }
}

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('repository owners do not require workspace mutation authority', async () => {
  setActiveWorkspaceUser(workspaceAActorId);
  await setActiveWorkspace(workspaceAId);

  await withGitHubServer(async baseUrl => {
    const ownersResponse = await fetch(`${baseUrl}/ext/github/repository-owners`);
    assert.equal(ownersResponse.status, 409);
  });
});

test('retired user-connection aliases are not served', async () => {
  setActiveWorkspaceUser(workspaceAActorId);
  await setActiveWorkspace(workspaceAId);

  await withGitHubServer(async baseUrl => {
    assert.equal((await fetch(`${baseUrl}/ext/github/user-connection`)).status, 404);
    assert.equal(
      (await fetch(`${baseUrl}/ext/github/user-connection/authorize`, { method: 'POST' })).status,
      404
    );
  });
});

test('project routes authorize against the resource workspace, not the active workspace', async () => {
  setActiveWorkspaceUser(workspaceAActorId);
  const secondary = await createWorkspace({
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    name: 'GitHub Route Secondary Workspace'
  });
  const project = await createProject({
    name: 'GitHub Route Secondary Project',
    workspaceId: secondary.id
  });

  const client = requireDatabaseClient();
  const workspaceBActor = await client.get<{ id: string }>(
    `SELECT id FROM workspace_users
      WHERE workspace_id = ? AND profile_id = 'operator-user' AND deleted_at IS NULL`,
    [secondary.id]
  );
  assert.ok(workspaceBActor);
  await client.run(
    `UPDATE role_assignments
        SET deleted_at = ?, updated_at = ?, revision = revision + 1
      WHERE workspace_id = ? AND workspace_user_id = ? AND deleted_at IS NULL`,
    [new Date().toISOString(), new Date().toISOString(), secondary.id, workspaceBActor.id]
  );

  await setActiveWorkspace(workspaceAId);
  assert.equal(getActorWorkspaceUserId(), workspaceAActorId);

  await withGitHubServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/ext/github/projects/${project.id}/link`);
    assert.equal(response.status, 403);
  });
});
