import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { listenForTest, type TestServer } from './http/test-app-fixture.ts';

/**
 * The REST boundary of the real app (ADR 0051): every registered route with an
 * operation carries the request-validation layer right before its handler, behind
 * its authentication, and a body that is not JSON answers 401 before
 * authentication and 400 after it.
 */

process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4327';

const { createIntegrationTestDb } = await import('./test-helpers.ts');
const { tempDir } = await createIntegrationTestDb('overlord-api-boundary-');
const { createProject, createUserToken, listObjectives } = await import('./repository.ts');
const { app } = await import('./app.ts');
const { registeredRoutes, toOpenapiPath } = await import('./http/express-routes.ts');
const { operationFor } = await import('./http/api-operations.ts');

let server: TestServer;
let baseUrl = '';
let secret = '';

before(async () => {
  secret = (await createUserToken({ label: 'api-boundary' })).secret;
  server = await listenForTest(app);
  baseUrl = server.baseUrl;
});

describe('REST boundary', () => {
  it('installs request validation before the handler of every described route', () => {
    const routes = registeredRoutes(
      (app as unknown as { _router: { stack: never[] } })._router.stack
    );
    const described = routes.filter(route =>
      route.methods.some(method => operationFor(method, toOpenapiPath(route.path)))
    );
    assert.ok(described.length > 250, `only ${described.length} described routes`);
    for (const route of described) {
      const names = route.stack.map(layer => layer.name);
      assert.equal(
        names.at(-2),
        'apiRequestValidation',
        `${route.methods.join(',')} ${route.path}: ${names.join(' > ')}`
      );
    }
    // Better Auth's wildcard, the one registered route without an operation (ADR 0048).
    const undescribed = routes.filter(route => !described.includes(route)).map(route => route.path);
    assert.deepEqual(undescribed, ['/api/auth/*']);
  });

  it('answers a body that is not JSON with 401 before authentication and 400 after it', async () => {
    const send = (authorization?: string) =>
      fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {})
        },
        body: '{"name":'
      });
    const anonymous = await send();
    assert.equal(anonymous.status, 401);
    const authenticated = await send(`Bearer ${secret}`);
    assert.equal(authenticated.status, 400);
    assert.deepEqual(await authenticated.json(), {
      error: 'Request body is not valid JSON.',
      code: 'invalid_json'
    });
  });

  it('applies the agent-session routers’ own body limits, not the app-level 100 KB one', async () => {
    const post = (path: string, bytes: number, authorization?: string) =>
      fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {})
        },
        body: JSON.stringify({ padding: 'x'.repeat(bytes) })
      });
    const tooLarge = { error: 'Request body is too large.', code: 'body_too_large' };

    // Channel router: 64 KiB, parsed before the channel credential is checked.
    const channel = await post('/api/agent-session-channels/v1/heartbeat', 70 * 1024);
    assert.equal(channel.status, 413);
    assert.deepEqual(await channel.json(), tooLarge);
    // A small body still reaches the channel credential check.
    assert.equal((await post('/api/agent-session-channels/v1/heartbeat', 16)).status, 401);

    // Human request router: 32 KiB, behind ordinary API authentication.
    const requests = await post('/api/agent-requests/r1/resolve', 40 * 1024, `Bearer ${secret}`);
    assert.equal(requests.status, 413);
    assert.deepEqual(await requests.json(), tooLarge);

    // Human session-input router: 64 KiB.
    const inputs = await post('/api/agent-session-inputs', 70 * 1024, `Bearer ${secret}`);
    assert.equal(inputs.status, 413);
    assert.deepEqual(await inputs.json(), tooLarge);
  });

  it('keeps a handler’s own answer and answers 400 where the handler would fail', async () => {
    const create = (body: unknown) =>
      fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify(body)
      });
    const missing = await create({});
    assert.equal(missing.status, 400);
    assert.notEqual((await missing.json()).code, 'invalid_request');

    const wrongType = await create({ name: 12 });
    assert.equal(wrongType.status, 400);
    const body = await wrongType.json();
    assert.equal(body.code, 'invalid_request');
    assert.deepEqual(
      body.details.issues.map((issue: { in: string; path: string }) => `${issue.in}.${issue.path}`),
      ['body.name']
    );
  });
});

describe('POST /api/objectives launch selection', () => {
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const newMission = async () => {
    const project = await createProject({
      name: `Create selection ${Date.now()}-${Math.random()}`
    });
    const mission = await call('POST', '/api/missions', {
      projectId: project.id,
      objectives: [{ instructions: 'First step' }]
    });
    assert.equal(mission.status, 200, JSON.stringify(mission.body));
    return mission.body.id as string;
  };

  it('creates an objective carrying the full launch selection in one request', async () => {
    const missionId = await newMission();
    const created = await call('POST', '/api/objectives', {
      missionId,
      instructionText: 'Configured at creation',
      assignedAgent: 'codex',
      model: 'gpt-6.1-terra',
      reasoningEffort: 'high',
      launchConfigAgent: 'codex',
      launchConfigOverride: {
        preCommand: '  source .env  ',
        flags: ['--search', { name: '--x', value: 'y' }]
      }
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.state, 'draft');
    assert.equal(created.body.assignedAgent, 'codex');
    assert.equal(created.body.model, 'gpt-6.1-terra');
    assert.equal(created.body.reasoningEffort, 'high');
    assert.deepEqual(created.body.launchConfigOverrides, {
      '*': {
        codex: {
          preCommand: 'source .env',
          flags: [
            { name: '--search', value: null },
            { name: '--x', value: 'y' }
          ]
        }
      }
    });
  });

  it('rejects an invalid combination and leaves no objective behind', async () => {
    const missionId = await newMission();
    const before = (await listObjectives(missionId)).length;
    const cases: Array<[Record<string, unknown>, string | undefined]> = [
      [{ model: 'gpt-6.1-terra' }, 'validation_error'],
      [{ assignedAgent: 'manual', model: 'claude-opus-5-5' }, 'validation_error'],
      [{ assignedAgent: 'human', reasoningEffort: 'high' }, 'validation_error'],
      [{ assignedAgent: 'claude', launchConfigOverride: { preCommand: 'x' } }, undefined],
      [
        {
          assignedAgent: 'claude',
          launchConfigAgent: '  ',
          launchConfigOverride: { preCommand: 'x' }
        },
        undefined
      ]
    ];
    for (const [selection, code] of cases) {
      const rejected = await call('POST', '/api/objectives', {
        missionId,
        instructionText: 'Must not be created',
        ...selection
      });
      assert.equal(rejected.status, 400, JSON.stringify({ selection, body: rejected.body }));
      if (code !== undefined) assert.equal(rejected.body.code, code);
      else assert.equal(rejected.body.error, 'launchConfigAgent is required');
    }
    assert.equal((await listObjectives(missionId)).length, before);
  });

  it('keeps the existing defaults when the new members are omitted', async () => {
    const missionId = await newMission();
    const created = await call('POST', '/api/objectives', {
      missionId,
      instructionText: 'Plain create'
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.model, null);
    assert.equal(created.body.reasoningEffort, null);
    assert.deepEqual(created.body.launchConfigOverrides, {});

    const agentOnly = await call('POST', '/api/objectives', {
      missionId,
      instructionText: 'Agent only',
      assignedAgent: 'claude',
      launchConfigAgent: 'claude',
      launchConfigOverride: null
    });
    assert.equal(agentOnly.status, 200, JSON.stringify(agentOnly.body));
    assert.equal(agentOnly.body.assignedAgent, 'claude');
    assert.equal(agentOnly.body.model, null);
    assert.deepEqual(agentOnly.body.launchConfigOverrides, {});
  });
});

after(async () => {
  await server.close();
  rmSync(tempDir, { recursive: true, force: true });
});
