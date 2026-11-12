import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

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
const { createUserToken } = await import('./repository.ts');
const { app } = await import('./app.ts');
const { registeredRoutes, toOpenapiPath } = await import('./http/express-routes.ts');
const { operationFor } = await import('./http/api-operations.ts');

let server: Server;
let baseUrl = '';
let secret = '';

before(async () => {
  secret = (await createUserToken({ label: 'api-boundary' })).secret;
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
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

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});
