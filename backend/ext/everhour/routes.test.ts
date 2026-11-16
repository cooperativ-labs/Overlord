import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listenForTest, routerTestApp } from '../../http/test-app-fixture.ts';

process.env.EVERHOUR_API_KEY_ENCRYPTION_KEY ??= Buffer.alloc(32, 11).toString('base64url');
const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-everhour-routes-'));
const { bootstrapIntegrationTestDb } = await import('../../test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'everhour-routes.sqlite') });

const { setActiveTokenAuth, setActiveWorkspaceUser } = await import('../../db.ts');
const { createMission, createProject } = await import('../../repository.ts');
const { createEverhourExtensionRouter } = await import('./routes.ts');

const operatorWorkspaceUserId = (await import('../../db.ts')).getActorWorkspaceUserId();

async function withEverhourServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const { profileConnections } = await import('../../connections/profile.ts');
  const { requireDatabaseClient } = await import('../../db.ts');
  const { everhourConnectionProvider } = await import('./connection-provider.ts');
  const { validateEverhourApiKey } = await import('./service.ts');
  const profiles = profileConnections(requireDatabaseClient(), [
    everhourConnectionProvider(validateEverhourApiKey)
  ]);
  const app = routerTestApp((app, handle) => {
    app.use(
      '/ext/everhour',
      createEverhourExtensionRouter(handle, () => profiles)
    );
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

test('retired connection aliases are not served', async () => {
  setActiveWorkspaceUser(operatorWorkspaceUserId);

  await withEverhourServer(async baseUrl => {
    for (const path of ['/ext/everhour/user-connection', '/ext/everhour/integration']) {
      assert.equal((await fetch(`${baseUrl}${path}`)).status, 404);
    }
  });
});

test('GET /ext/everhour/projects/:projectId/link requires project:read', async () => {
  setActiveWorkspaceUser(operatorWorkspaceUserId);
  const project = await createProject({ name: 'Route Permission Project' });

  setActiveTokenAuth({
    workspaceUserId: operatorWorkspaceUserId,
    tokenId: 'tok-project-read-test',
    scopeGrants: ['workspace:read', 'mission:read']
  });

  await withEverhourServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/ext/everhour/projects/${project.id}/link`);
    assert.equal(response.status, 403);
  });
});

test('GET /ext/everhour/missions/:missionId requires mission:read', async () => {
  setActiveWorkspaceUser(operatorWorkspaceUserId);
  const project = await createProject({ name: 'Mission Route Project' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Read state' });

  setActiveTokenAuth({
    workspaceUserId: operatorWorkspaceUserId,
    tokenId: 'tok-mission-read-test',
    scopeGrants: ['workspace:read', 'project:read']
  });

  await withEverhourServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/ext/everhour/missions/${mission.id}`);
    assert.equal(response.status, 403);
  });
});

test('GET /ext/everhour/projects/:projectId requires project:read', async () => {
  setActiveWorkspaceUser(operatorWorkspaceUserId);
  const project = await createProject({ name: 'Project Timer Route Project' });

  setActiveTokenAuth({
    workspaceUserId: operatorWorkspaceUserId,
    tokenId: 'tok-project-timer-read-test',
    scopeGrants: ['workspace:read', 'mission:read']
  });

  await withEverhourServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/ext/everhour/projects/${project.id}`);
    assert.equal(response.status, 403);
  });
});
