import { apiOperations } from '@overlord/contract/api';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

/**
 * Response conformance for the read surface (ADR 0051): every GET operation of the
 * real app is called with a user token against a small fixture (one project, one
 * mission with an objective), and each answer — success or error — must match its
 * operation in contract/api/openapi.yaml with undocumented members refused. Streams,
 * provider-backed extension routes and the sign-in handoffs are left to their own
 * tests.
 */

process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4327';
// Register every route family, as the route inventory does.
process.env.OVERLORD_MCP_ENABLED = 'true';

const { createIntegrationTestDb, DEFAULT_TEST_ORGANIZATION_ID } = await import('./test-helpers.ts');
const { tempDir } = await createIntegrationTestDb('overlord-api-read-conformance-');
const { createMission, createProject, createUserToken } = await import('./repository.ts');
const { app } = await import('./app.ts');
const { checkResponse, mediaTypeOf } = await import('./http/response-conformance.ts');

const SKIPPED = new Set([
  // Sign-in handoffs drive Better Auth and browser redirects.
  'getAuthDesktopGithub',
  'getAuthDesktopCallback',
  'getAuthBrowserCallback',
  'getAuthCallbackGithubRepository',
  // Event streams stay open; their own tests cover them.
  'getStream',
  'getRealtime',
  'getChatThreadsByIdEvents'
]);

let server: Server;
let baseUrl = '';
let secret = '';
const ids: Record<string, string> = {};

before(async () => {
  secret = (await createUserToken({ label: 'read-conformance' })).secret;
  const project = await createProject({ name: 'Read Conformance' });
  const mission = await createMission({
    projectId: project.id,
    title: 'Conformance mission',
    firstObjective: 'Check every read'
  });
  ids.projects = project.id;
  ids.missions = mission.id;
  ids.objectives = mission.objectives[0]?.id ?? 'unknown-objective';
  ids.workspaces = project.workspaceId;
  ids.organizations = DEFAULT_TEST_ORGANIZATION_ID;
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

const QUERY: Record<string, string> = { after: '0', agent: 'codex' };

function concretePath(template: string): string {
  const segments = template.split('/');
  return segments
    .map((segment, index) => {
      if (!segment.startsWith('{')) return segment;
      return encodeURIComponent(ids[segments[index - 1] ?? ''] ?? 'unknown-id');
    })
    .join('/');
}

function query(operation: (typeof apiOperations)[keyof typeof apiOperations]): string {
  const schema = operation.parameters.query as unknown as {
    shape?: Record<string, { _zod: { def: { type: string } } }>;
  } | null;
  const params = new URLSearchParams();
  for (const [name, member] of Object.entries(schema?.shape ?? {})) {
    if (member._zod.def.type === 'optional') continue;
    params.set(name, name === 'workspaceId' ? (ids.workspaces ?? '') : (QUERY[name] ?? 'x'));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

describe('read surface conformance', () => {
  it('treats blank workspace IDs as omitted without granting an implicit HTTP workspace', async () => {
    const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
    const catalogResponse = await fetch(
      `${baseUrl}/api/agent-catalog?workspaceId=${ids.workspaces}`,
      { headers }
    );
    assert.equal(catalogResponse.status, 200);
    const catalog = (await catalogResponse.json()) as { agents: unknown[] };
    const routes = [
      { method: 'GET', path: '/api/agent-catalog' },
      { method: 'POST', path: '/api/agent-catalog/refresh', body: {} },
      { method: 'PUT', path: '/api/agent-catalog', body: { agents: catalog.agents } },
      { method: 'GET', path: '/api/launch-settings' },
      { method: 'PATCH', path: '/api/launch-settings/agents/codex', body: {} },
      { method: 'PATCH', path: '/api/launch-settings/terminal-profile', body: {} },
      { method: 'PATCH', path: '/api/launch-settings/session-defaults', body: {} },
      {
        method: 'PATCH',
        path: '/api/launch-settings/worktree-branch-automation',
        body: { enabled: false }
      }
    ];
    for (const route of routes) {
      const init = {
        method: route.method,
        headers,
        body: route.body ? JSON.stringify(route.body) : undefined
      };
      const baseline = await fetch(`${baseUrl}${route.path}`, init);
      const baselineBody = await baseline.json();
      assert.ok(baseline.status === 400, `${route.path}: ${JSON.stringify(baselineBody)}`);
      const blank = await fetch(`${baseUrl}${route.path}?workspaceId=%20%20`, init);
      const blankBody = await blank.json();
      assert.equal(blank.status, baseline.status, `${route.path}: ${JSON.stringify(blankBody)}`);
      assert.deepEqual(blankBody, baselineBody, route.path);
    }
    for (const path of ['/api/agent-catalog', '/api/launch-settings']) {
      const response = await fetch(
        `${baseUrl}${path}?workspaceId=${encodeURIComponent(` ${ids.workspaces} `)}`,
        { headers }
      );
      assert.equal(response.status, 200, path);
      await response.json();
    }
  });

  it('answers every GET operation as the description declares', async () => {
    const problems: string[] = [];
    let checked = 0;
    for (const operation of Object.values(apiOperations)) {
      if (operation.method !== 'GET' || SKIPPED.has(operation.operationId)) continue;
      if (operation.extension !== null) continue;
      const response = await fetch(`${baseUrl}${concretePath(operation.path)}${query(operation)}`, {
        headers: { authorization: `Bearer ${secret}` },
        redirect: 'manual'
      });
      const contentType = mediaTypeOf(response.headers.get('content-type'));
      const body = contentType === 'text/event-stream' ? null : await response.text();
      checked += 1;
      for (const problem of checkResponse(operation, response.status, contentType, body)) {
        problems.push(`${operation.operationId} ${response.status}: ${problem}`);
      }
    }
    assert.ok(checked > 70, `only ${checked} operations checked`);
    assert.deepEqual(problems, []);
  });
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});
