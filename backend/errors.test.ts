import assert from 'node:assert/strict';
import test from 'node:test';

import { ServiceError } from '../packages/core/service/errors.ts';

import { ApiError, apiErrorFromBodyParser, apiErrorHandler, rethrowNotFoundAs } from './errors.ts';

test('maps body-parser entity.too.large onto a 413 without duplicating the message', () => {
  const mapped = apiErrorFromBodyParser({
    type: 'entity.too.large',
    status: 413,
    statusCode: 413,
    message: 'request entity too large'
  });
  assert.ok(mapped);
  assert.equal(mapped.status, 413);
  assert.equal(mapped.code, 'body_too_large');
  assert.equal(mapped.message, 'Request body is too large.');
  assert.equal(mapped.detail, undefined);
});

test('ignores unrelated errors', () => {
  assert.equal(apiErrorFromBodyParser(new Error('boom')), null);
  assert.equal(apiErrorFromBodyParser({ status: 400, message: 'bad' }), null);
});

test('rethrowNotFoundAs relabels a service 404 and keeps its code', () => {
  assert.throws(
    () => rethrowNotFoundAs(new ServiceError('x', 'not_found', 404), 'Project not found'),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 404 &&
      error.message === 'Project not found' &&
      error.code === 'not_found'
  );
});

test('rethrowNotFoundAs rethrows other errors untouched, and a 409 reaches the handler with its code', () => {
  const conflict = new ServiceError('Has active queue', 'execution_target_has_active_queue', 409);
  assert.throws(
    () => rethrowNotFoundAs(conflict, 'Execution target not found'),
    error => error === conflict
  );
  let status = 0;
  let body: unknown;
  const res = {
    status(value: number) {
      status = value;
      return this;
    },
    json(value: unknown) {
      body = value;
    }
  };
  apiErrorHandler(conflict, {} as never, res as never, (() => undefined) as never);
  assert.equal(status, 409);
  assert.deepEqual(body, {
    error: 'Has active queue',
    code: 'execution_target_has_active_queue'
  });
});
