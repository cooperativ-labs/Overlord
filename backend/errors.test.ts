import assert from 'node:assert/strict';
import test from 'node:test';

import { apiErrorFromBodyParser } from './errors.ts';

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
