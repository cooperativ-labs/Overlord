import assert from 'node:assert/strict';
import test from 'node:test';

import { latchChildEnvironment } from './latch-environment.ts';

test('injects a UTF-8 LC_CTYPE when the parent has no locale at all', () => {
  const env = latchChildEnvironment({
    baseEnv: { HOME: '/Users/jake', PATH: '/usr/bin:/bin' },
    platform: 'darwin'
  });
  assert.equal(env.LC_CTYPE, 'UTF-8');
  assert.equal(env.HOME, '/Users/jake');
  assert.equal(env.PATH, '/usr/bin:/bin');
});

test('uses the glibc C.UTF-8 locale off macOS', () => {
  const env = latchChildEnvironment({ baseEnv: {}, platform: 'linux' });
  assert.equal(env.LC_CTYPE, 'C.UTF-8');
});

test('leaves an already-configured UTF-8 locale untouched', () => {
  for (const baseEnv of [
    { LANG: 'en_US.UTF-8' },
    { LC_CTYPE: 'UTF-8' },
    { LC_ALL: 'de_DE.utf8' }
  ]) {
    const env = latchChildEnvironment({ baseEnv, platform: 'darwin' });
    assert.deepEqual(env, baseEnv);
  }
});

test('overrides a non-UTF-8 LC_CTYPE and drops a conflicting LC_ALL', () => {
  const env = latchChildEnvironment({
    baseEnv: { LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C' },
    platform: 'darwin'
  });
  assert.equal(env.LC_CTYPE, 'UTF-8');
  assert.equal(env.LC_ALL, undefined);
  assert.equal(env.LANG, 'C');
});
