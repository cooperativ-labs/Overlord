import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-protocol-flags-'));
const { bootstrapIntegrationTestDb } = await import('../test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });
const { ApiError } = await import('../errors.ts');
const { integerFlag } = await import('./flags.ts');

test('integer flags accept only safe decimal integers and enforce bounds', () => {
  const read = (value: string) => integerFlag({ flags: { '--value': value } }, '--value');
  assert.equal(integerFlag({}, '--value'), undefined);
  assert.equal(integerFlag({}, '--value', { fallback: 20 }), 20);
  assert.equal(read('3'), 3);
  assert.equal(read('-3'), -3);
  for (const value of ['3abc', 'abc', '', ' 3', '1.0', '1e2', '9007199254740992']) {
    assert.throws(
      () => read(value),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 400 &&
        error.code === 'invalid_input' &&
        error.message.includes('--value')
    );
  }
  assert.throws(() => integerFlag({ flags: { '--value': '0' } }, '--value', { min: 1 }));
  assert.throws(() => integerFlag({ flags: { '--value': '4' } }, '--value', { max: 3 }));
});
