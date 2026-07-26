import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-project-initialization-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const { db } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'project-initialization.sqlite')
});
const { getActiveWorkspaceId } = await import('./db.ts');
const { initializeProject } = await import('./repository.ts');
const { beginGitHubUserAuthorization, completeGitHubUserAuthorization } =
  await import('./ext/github/user-oauth.ts');
const originalFetch = globalThis.fetch;
const originalGithubEnv = {
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  encryptionKey: process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY,
  authUrl: process.env.BETTER_AUTH_URL
};

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalGithubEnv)) {
    const envKey =
      key === 'clientId'
        ? 'GITHUB_CLIENT_ID'
        : key === 'clientSecret'
          ? 'GITHUB_CLIENT_SECRET'
          : key === 'encryptionKey'
            ? 'GITHUB_USER_TOKEN_ENCRYPTION_KEY'
            : 'BETTER_AUTH_URL';
    if (value === undefined) delete process.env[envKey];
    else process.env[envKey] = value;
  }
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test('provisions one private repository and one read-only git resource on retry', async () => {
  process.env.GITHUB_CLIENT_ID = 'initialization-client';
  process.env.GITHUB_CLIENT_SECRET = 'initialization-secret';
  process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url');
  process.env.BETTER_AUTH_URL = 'https://overlord.example';
  const authorization = await beginGitHubUserAuthorization({}, []);
  const state = new URL(authorization.authorizationUrl).searchParams.get('state');
  assert.ok(state);
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json({ access_token: 'token', scope: 'repo read:org' });
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({ id: 912, login: 'octocat', avatar_url: null });
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  };
  await completeGitHubUserAuthorization({ code: 'code', state });

  let createCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://api.github.com/user') {
      return Response.json({ id: 912, login: 'octocat', avatar_url: null });
    }
    if (url.includes('/user/memberships/orgs')) return Response.json([]);
    if (url === 'https://api.github.com/user/repos') {
      createCalls += 1;
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        name: 'field-repository',
        private: true,
        auto_init: false
      });
      return Response.json({
        id: 1234,
        full_name: 'octocat/field-repository',
        default_branch: 'main',
        private: true,
        clone_url: 'https://github.com/octocat/field-repository.git',
        owner: { login: 'octocat' }
      });
    }
    throw new Error(`Unexpected GitHub request: ${url}`);
  };
  const body = {
    workspaceId: getActiveWorkspaceId(),
    idempotencyKey: 'mobile-create-project-002',
    name: 'Field Repository',
    description: 'Give this mobile idea a home.',
    createGitHubRepository: true,
    githubOwnerLogin: 'octocat'
  };
  const created = await initializeProject(body);
  const retried = await initializeProject(body);
  assert.equal(createCalls, 1);
  assert.equal(created.repositoryProvisioning.status, 'succeeded');
  assert.equal(retried.repositoryProvisioning.status, 'succeeded');
  assert.equal(created.repositoryProvisioning.repository?.private, true);
  assert.equal(created.repositoryProvisioning.resource?.isPrimary, false);
  assert.equal(created.repositoryProvisioning.resource?.accessMode, 'read');
  assert.equal(created.repositoryProvisioning.resource?.sources[0]?.sourceKind, 'git');
  const links = db
    .prepare(`SELECT COUNT(*) AS count FROM ext_github_project_links WHERE project_id = ?`)
    .get(created.project.id) as { count: number };
  assert.equal(links.count, 1);
});

test('initializes a project and its first mission atomically and idempotently', async () => {
  const body = {
    workspaceId: getActiveWorkspaceId(),
    idempotencyKey: 'mobile-create-project-001',
    name: 'Field Notes',
    description: 'Capture the first idea before it is lost.',
    createGitHubRepository: false
  };
  const created = await initializeProject(body);
  const retried = await initializeProject(body);

  assert.equal(created.project.id, retried.project.id);
  assert.equal(created.mission.id, retried.mission.id);
  assert.equal(created.project.name, 'Field Notes');
  assert.equal(created.project.description, body.description);
  assert.equal(created.mission.title, 'Field Notes');
  assert.equal(created.mission.objectives[0]?.instructionText, body.description);
  assert.equal(created.repositoryProvisioning.status, 'not_requested');

  const projects = db
    .prepare(`SELECT COUNT(*) AS count FROM projects WHERE name = ?`)
    .get('Field Notes') as {
    count: number;
  };
  const missions = db
    .prepare(`SELECT COUNT(*) AS count FROM missions WHERE project_id = ?`)
    .get(created.project.id) as {
    count: number;
  };
  assert.equal(projects.count, 1);
  assert.equal(missions.count, 1);
});
