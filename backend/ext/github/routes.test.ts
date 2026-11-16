import { PERMISSIONS } from '@overlord/auth';
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { afterEach, before, describe, it } from 'node:test';

import { listenForTest, routerTestApp } from '../../http/test-app-fixture.ts';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-github-routes-'));
const { bootstrapIntegrationTestDb, DEFAULT_TEST_ORGANIZATION_ID } =
  await import('../../test-helpers.ts');
const { WORKSPACE } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'github-routes.sqlite')
});

const workspaceAId = WORKSPACE.id;
const dbModule = await import('../../db.ts');
const {
  getActorWorkspaceUserId,
  requireDatabaseClient,
  setActiveWorkspace,
  setActiveWorkspaceUser
} = dbModule;
const { createProject } = await import('../../repository.ts');
const { createWorkspace } = await import('../../workspaces.ts');
const { createGitHubExtensionRouter } = await import('./routes.ts');

const workspaceAActorId = getActorWorkspaceUserId();

type AuthorizedWorkspace = import('../../db.ts').AuthorizedWorkspace;

/**
 * When set, every request runs under this immutable authorization snapshot, as
 * `requireAuthenticatedSession` establishes for an authenticated HTTP request.
 * When null, requests use the process-local implicit workspace.
 */
let requestSnapshot: AuthorizedWorkspace[] | null = null;

function authorizedSnapshot(_req: ExpressRequest, _res: ExpressResponse, next: NextFunction): void {
  const workspaces = requestSnapshot;
  if (!workspaces) {
    next();
    return;
  }
  void dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveProfileId('operator-user');
    dbModule.setAuthorizedWorkspacesContext({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      workspaces
    });
    dbModule.setActiveWorkspaceContext(null);
    dbModule.setActiveWorkspaceUser(null);
    next();
  });
}

async function snapshotEntry(
  workspaceId: string,
  roleKeys: string[]
): Promise<AuthorizedWorkspace> {
  const row = await requireDatabaseClient().get<{
    workspace_user_id: string;
    slug: string;
    name: string;
    kind: string;
  }>(
    `SELECT wu.id AS workspace_user_id, w.slug, w.name, w.kind
       FROM workspaces w
       JOIN workspace_users wu ON wu.workspace_id = w.id
      WHERE w.id = ? AND wu.profile_id = 'operator-user' AND wu.deleted_at IS NULL`,
    [workspaceId]
  );
  assert.ok(row, `operator membership in ${workspaceId}`);
  return {
    workspaceId,
    workspaceUserId: row.workspace_user_id,
    roleKeys,
    workspace: { id: workspaceId, slug: row.slug, name: row.name, kind: row.kind }
  } as AuthorizedWorkspace;
}

const GITHUB_APP_ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'] as const;

/** Run `fn` with the GitHub App environment set (`config`) or cleared (`null`), then restore it. */
async function withGitHubAppEnv(
  config: Record<(typeof GITHUB_APP_ENV)[number], string> | null,
  fn: () => Promise<void>
): Promise<void> {
  const saved = GITHUB_APP_ENV.map(name => [name, process.env[name]] as const);
  for (const name of GITHUB_APP_ENV) {
    if (config) process.env[name] = config[name];
    else delete process.env[name];
  }
  try {
    await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function withGitHubServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const { profileConnections } = await import('../../connections/profile.ts');
  const { requireDatabaseClient } = await import('../../db.ts');
  const { githubConnectionProvider } = await import('./connection-provider.ts');
  const profiles = profileConnections(requireDatabaseClient(), [githubConnectionProvider()]);
  const app = routerTestApp((app, handle) => {
    app.use(authorizedSnapshot);
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

describe('GET /ext/github/callback', () => {
  let adminInA: AuthorizedWorkspace;
  let memberInA: AuthorizedWorkspace;
  let memberInCallbackWorkspace: AuthorizedWorkspace;

  before(async () => {
    setActiveWorkspaceUser(workspaceAActorId);
    await setActiveWorkspace(workspaceAId);
    const callbackWorkspace = await createWorkspace({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      name: 'GitHub Callback Workspace'
    });
    adminInA = await snapshotEntry(workspaceAId, ['ADMIN']);
    memberInA = await snapshotEntry(workspaceAId, ['MEMBER']);
    memberInCallbackWorkspace = await snapshotEntry(callbackWorkspace.id, ['MEMBER']);
  });

  afterEach(() => {
    requestSnapshot = null;
  });

  it('answers 403 when no authorized workspace grants workspace:update', async () => {
    requestSnapshot = [memberInA, memberInCallbackWorkspace];
    // With the GitHub App unconfigured the service would answer 400 first, so
    // this 403 can only come from the route's `requires: WORKSPACE_UPDATE` gate.
    await withGitHubAppEnv(null, async () => {
      await withGitHubServer(async baseUrl => {
        const response = await fetch(
          `${baseUrl}/ext/github/callback?installation_id=123&state=unsigned`
        );
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), {
          error: `Permission denied: ${PERMISSIONS.WORKSPACE_UPDATE}`
        });
      });
    });
  });

  it('completes the installation when one authorized workspace grants workspace:update', async () => {
    requestSnapshot = [memberInCallbackWorkspace, adminInA];
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const config = {
      GITHUB_APP_ID: '424242',
      GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      GITHUB_APP_SLUG: 'overlord-test-app'
    };

    const realFetch = globalThis.fetch;
    const githubCalls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
      githubCalls.push(url);
      return new Response(
        JSON.stringify({
          account: { login: 'overlord-test-org', type: 'Organization' },
          permissions: { contents: 'write' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      await withGitHubAppEnv(config, async () => {
        await withGitHubServer(async baseUrl => {
          const install = await realFetch(
            `${baseUrl}/ext/github/install?workspaceId=${encodeURIComponent(workspaceAId)}`,
            { method: 'POST' }
          );
          assert.equal(install.status, 200);
          const { installUrl } = (await install.json()) as { installUrl: string };
          const state = new URL(installUrl).searchParams.get('state');
          assert.ok(state);

          const response = await realFetch(
            `${baseUrl}/ext/github/callback?installation_id=987654&state=${encodeURIComponent(state)}`
          );
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), { connected: true });
        });
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.deepEqual(githubCalls, ['https://api.github.com/app/installations/987654']);
    const stored = await requireDatabaseClient().get<{
      github_installation_id: string;
      github_account_login: string;
    }>(
      `SELECT github_installation_id, github_account_login
         FROM ext_github_installations WHERE workspace_id = ?`,
      [workspaceAId]
    );
    assert.deepEqual(stored, {
      github_installation_id: '987654',
      github_account_login: 'overlord-test-org'
    });
  });
});
