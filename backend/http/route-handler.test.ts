import { type Permission, PERMISSIONS } from '@overlord/auth';
import express, { type NextFunction, type Request, type Response } from 'express';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { listenForTest, type TestServer } from './test-app-fixture.ts';

// `rbac.ts` imports `db.ts`, which opens the configured database at load.
const { createIntegrationTestDb } = await import('../test-helpers.ts');
const { tempDir } = await createIntegrationTestDb('overlord-route-handler-');
const dbModule = await import('../db.ts');
const { ApiError, apiErrorHandler } = await import('../errors.ts');
const { asyncRoute, createRouteHandler } = await import('./route-handler.ts');

/**
 * `createRouteHandler` is the route-level RBAC dispatch for every `handle()`
 * route in app.ts and the extension routers. These cases pin its contract:
 * `requires` is checked through `requireAnyWorkspacePermission` before the
 * handler runs, `onMutation` runs once and only after a successful `mutates`
 * route, a nullish result answers `{ ok: true }`, and a handler that already
 * answered is left alone.
 */

const ROLE_HEADER = 'x-test-role';

/** Stand in for `requireAuthenticatedSession`: an immutable workspace snapshot per request. */
function authorizedSnapshot(req: Request, _res: Response, next: NextFunction): void {
  const role = req.header(ROLE_HEADER);
  void dbModule.withRequestContextAsync(async () => {
    dbModule.setAuthorizedWorkspacesContext({
      organizationId: 'route-handler-org',
      workspaces: role
        ? [
            {
              workspaceId: 'route-handler-ws',
              workspaceUserId: 'route-handler-member',
              roleKeys: [role],
              workspace: {
                id: 'route-handler-ws',
                slug: 'route-handler',
                name: 'Route Handler',
                kind: 'team'
              }
            }
          ]
        : []
    });
    next();
  });
}

let mutations = 0;
let handlerCalls = 0;
let baseUrl = '';
let server: TestServer;

before(async () => {
  const handle = createRouteHandler({ onMutation: () => void mutations++ });
  const app = express();
  app.use(express.json());
  app.use(authorizedSnapshot);

  const guarded = (requires: Permission) =>
    handle(
      () => {
        handlerCalls++;
        return { ran: true };
      },
      { requires, mutates: true }
    );
  app.post('/requires/workspace-update', guarded(PERMISSIONS.WORKSPACE_UPDATE));
  app.get(
    '/returns-value',
    handle(() => ({ value: 42 }))
  );
  app.get(
    '/returns-nothing',
    handle(() => undefined)
  );
  app.post(
    '/mutates',
    handle(async () => ({ saved: true }), { mutates: true })
  );
  app.post(
    '/mutates-and-fails',
    handle(
      () => {
        throw new ApiError(409, 'Conflict');
      },
      { mutates: true }
    )
  );
  app.get(
    '/answers-itself',
    handle((_req, res) => {
      res.status(201).json({ own: true });
      return { ignored: true };
    })
  );
  app.get(
    '/async-route-rejects',
    asyncRoute(async () => {
      throw new ApiError(418, 'Rejected');
    })
  );
  app.get(
    '/async-route-throws',
    asyncRoute(() => {
      throw new ApiError(418, 'Thrown');
    })
  );
  app.use(apiErrorHandler);

  server = await listenForTest(app);
  baseUrl = server.baseUrl;
});

after(async () => {
  await server.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function call(
  method: 'GET' | 'POST',
  path: string,
  role?: string
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: role ? { [ROLE_HEADER]: role } : {}
  });
  return { status: response.status, body: await response.json() };
}

function reset(): void {
  mutations = 0;
  handlerCalls = 0;
}

describe('createRouteHandler requires', () => {
  it('answers 403 through requireAnyWorkspacePermission before the handler runs', async () => {
    reset();
    const denied = await call('POST', '/requires/workspace-update', 'MEMBER');
    assert.equal(denied.status, 403);
    assert.deepEqual(denied.body, {
      error: `Permission denied: ${PERMISSIONS.WORKSPACE_UPDATE}`
    });
    assert.equal(handlerCalls, 0);
    assert.equal(mutations, 0);
  });

  it('denies an empty authorization snapshot', async () => {
    reset();
    const denied = await call('POST', '/requires/workspace-update');
    assert.equal(denied.status, 403);
    assert.equal(handlerCalls, 0);
    assert.equal(mutations, 0);
  });

  it('runs the handler when any snapshot workspace grants the permission', async () => {
    reset();
    const allowed = await call('POST', '/requires/workspace-update', 'ADMIN');
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.body, { ran: true });
    assert.equal(handlerCalls, 1);
    assert.equal(mutations, 1);
  });
});

describe('createRouteHandler mutates', () => {
  it('calls onMutation once after a successful mutation', async () => {
    reset();
    const saved = await call('POST', '/mutates');
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, { saved: true });
    assert.equal(mutations, 1);
  });

  it('does not call onMutation when the handler fails', async () => {
    reset();
    const failed = await call('POST', '/mutates-and-fails');
    assert.equal(failed.status, 409);
    assert.deepEqual(failed.body, { error: 'Conflict' });
    assert.equal(mutations, 0);
  });

  it('does not call onMutation for a route that does not mutate', async () => {
    reset();
    await call('GET', '/returns-value');
    assert.equal(mutations, 0);
  });
});

describe('createRouteHandler response', () => {
  it('writes the returned value as JSON', async () => {
    assert.deepEqual(await call('GET', '/returns-value'), { status: 200, body: { value: 42 } });
  });

  it('answers { ok: true } when the handler returns nothing', async () => {
    assert.deepEqual(await call('GET', '/returns-nothing'), { status: 200, body: { ok: true } });
  });

  it('leaves a response the handler already sent', async () => {
    assert.deepEqual(await call('GET', '/answers-itself'), { status: 201, body: { own: true } });
  });
});

describe('asyncRoute', () => {
  it('forwards a rejection to the error handler', async () => {
    assert.deepEqual(await call('GET', '/async-route-rejects'), {
      status: 418,
      body: { error: 'Rejected' }
    });
  });

  it('forwards a synchronous throw to the error handler', async () => {
    assert.deepEqual(await call('GET', '/async-route-throws'), {
      status: 418,
      body: { error: 'Thrown' }
    });
  });
});
