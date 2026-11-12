import express, { type NextFunction, type Request, type Response } from 'express';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, describe, it, mock } from 'node:test';

import { ApiError, apiErrorHandler } from '../errors.ts';

import { CONFORMANCE_REPORT_ENV } from './conformance-report.ts';
import {
  deferMalformedBody,
  installRequestValidation,
  REQUEST_VALIDATION_ENV,
  requestValidationMode
} from './request-validation.ts';

type Behaviour = 'ok' | 'crash' | 'refuse' | 'missing';

/**
 * A miniature of backend/app.ts: the deferred JSON parser, an authentication guard
 * on /api, real operation paths with stand-in handlers, validation installed after
 * the routes, and the app's error handler.
 */
async function serve(behaviour: Behaviour) {
  const app = express();
  app.use(deferMalformedBody(express.json()));
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization !== 'Bearer ok') {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    next();
  });
  const handler = (req: Request, res: Response, next: NextFunction) => {
    try {
      if (behaviour === 'crash') {
        // A handler that assumes its input is well-typed.
        res.json({ label: (req.body.label as string).trim() });
        return;
      }
      if (behaviour === 'refuse') throw new ApiError(400, 'label is required');
      if (behaviour === 'missing') throw new ApiError(404, 'Project not found');
      res.json({ id: 'tag', projectId: req.params.id, label: 'x', color: null, active: true });
    } catch (error) {
      next(error);
    }
  };
  app.post('/api/projects/:id/tags', handler);
  app.get('/api/projects', (req, res, next) => {
    try {
      if (behaviour === 'crash' && typeof req.query.lifecycle === 'string') {
        if (!['active', 'archived', 'all'].includes(req.query.lifecycle)) throw new Error('boom');
      }
      res.json([]);
    } catch (error) {
      next(error);
    }
  });
  assert.equal(installRequestValidation(app as never), 2);
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}

function post(base: string, body: string, auth = true) {
  return fetch(`${base}/api/projects/p1/tags`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: 'Bearer ok' } : {})
    },
    body
  });
}

// These tests send requests the description refuses on purpose; keep them out of
// the suite's conformance report.
const report = process.env[CONFORMANCE_REPORT_ENV];
before(() => {
  delete process.env[CONFORMANCE_REPORT_ENV];
});
after(() => {
  if (report !== undefined) process.env[CONFORMANCE_REPORT_ENV] = report;
});

afterEach(() => {
  delete process.env[REQUEST_VALIDATION_ENV];
  mock.restoreAll();
});

describe('request validation at the boundary', () => {
  it('reads the mode switch, defaulting to enforce', () => {
    assert.equal(requestValidationMode({}), 'enforce');
    assert.equal(requestValidationMode({ [REQUEST_VALIDATION_ENV]: 'warn' }), 'warn');
    assert.equal(requestValidationMode({ [REQUEST_VALIDATION_ENV]: ' OFF ' }), 'off');
    const warn = mock.method(console, 'warn', () => undefined);
    assert.equal(requestValidationMode({ [REQUEST_VALIDATION_ENV]: 'strict' }), 'enforce');
    assert.ok(warn.mock.callCount() <= 1);
  });

  it('leaves a valid request to its handler', async () => {
    const app = await serve('ok');
    try {
      const response = await post(app.base, JSON.stringify({ label: 'Bug' }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).projectId, 'p1');
    } finally {
      await app.close();
    }
  });

  it('answers 400 with the issues when the handler fails on a wrong-typed member', async () => {
    const warn = mock.method(console, 'warn', () => undefined);
    const app = await serve('crash');
    try {
      const response = await post(app.base, JSON.stringify({ label: 4242 }));
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.code, 'invalid_request');
      assert.match(body.error, /^Invalid request: body\.label: /);
      assert.deepEqual(
        body.details.issues.map((issue: { in: string; path: string; code: string }) => [
          issue.in,
          issue.path,
          issue.code
        ]),
        [['body', 'label', 'invalid_type']]
      );
      assert.ok(!JSON.stringify(body).includes('4242'), 'the submitted value is not echoed');
      const logged = JSON.parse(String(warn.mock.calls.at(-1)?.arguments[0]));
      assert.equal(logged.outcome, 'rejected');
      assert.equal(logged.operationId, 'postProjectsByIdTags');
    } finally {
      await app.close();
    }
  });

  it('keeps the handler’s own 4xx answer for an invalid request', async () => {
    for (const [behaviour, status, error] of [
      ['refuse', 400, 'label is required'],
      ['missing', 404, 'Project not found']
    ] as const) {
      const app = await serve(behaviour);
      try {
        const response = await post(app.base, JSON.stringify({ label: 7 }));
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), { error });
      } finally {
        await app.close();
      }
    }
  });

  it('answers a malformed JSON body 400 after authentication, 401 before it', async () => {
    const app = await serve('ok');
    try {
      const anonymous = await post(app.base, '{"label":', false);
      assert.equal(anonymous.status, 401);
      const response = await post(app.base, '{"label":');
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: 'Request body is not valid JSON.',
        code: 'invalid_json'
      });
    } finally {
      await app.close();
    }
  });

  it('validates query parameters', async () => {
    mock.method(console, 'warn', () => undefined);
    const app = await serve('crash');
    try {
      const response = await fetch(`${app.base}/api/projects?lifecycle=bogus`, {
        headers: { authorization: 'Bearer ok' }
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.details.issues[0].in, 'query');
      assert.equal(body.details.issues[0].path, 'lifecycle');
    } finally {
      await app.close();
    }
  });

  it('logs a request the handler accepts although the description refuses it', async () => {
    const warn = mock.method(console, 'warn', () => undefined);
    const app = await serve('ok');
    try {
      const response = await post(app.base, JSON.stringify({ label: 3 }));
      assert.equal(response.status, 200);
      const logged = JSON.parse(String(warn.mock.calls.at(-1)?.arguments[0]));
      assert.equal(logged.event, 'api_request_validation');
      assert.equal(logged.outcome, 'accepted');
      assert.deepEqual(logged.issues, [{ in: 'body', path: 'label', code: 'invalid_type' }]);
    } finally {
      await app.close();
    }
  });

  it('only logs in warn mode', async () => {
    process.env[REQUEST_VALIDATION_ENV] = 'warn';
    const warn = mock.method(console, 'warn', () => undefined);
    mock.method(console, 'error', () => undefined);
    const app = await serve('crash');
    try {
      const response = await post(app.base, JSON.stringify({ label: 1 }));
      assert.equal(response.status, 500);
      const logged = JSON.parse(String(warn.mock.calls.at(-1)?.arguments[0]));
      assert.equal(logged.outcome, 'would_reject');
      assert.equal(logged.mode, 'warn');
    } finally {
      await app.close();
    }
  });

  it('does nothing when off, and the error handler still answers malformed JSON 400', async () => {
    process.env[REQUEST_VALIDATION_ENV] = 'off';
    const warn = mock.method(console, 'warn', () => undefined);
    mock.method(console, 'error', () => undefined);
    const app = await serve('crash');
    try {
      const crashed = await post(app.base, JSON.stringify({ label: 1 }));
      assert.equal(crashed.status, 500);
      assert.equal(warn.mock.callCount(), 0);
      const malformed = await post(app.base, '{', false);
      assert.equal(malformed.status, 400);
      assert.equal((await malformed.json()).code, 'invalid_json');
    } finally {
      await app.close();
    }
  });
});
