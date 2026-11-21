import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localOpenRouterEnvironment } from './local-openrouter-env.js';

test('packaged local backend gets only the user-supplied provider key', () => {
  const parent = { OPENROUTER_API_KEY: 'parent', CHAT_OPENROUTER_API_KEY: 'parent-chat', OTHER: 'ok' };
  const none = localOpenRouterEnvironment({ environment: parent, userKey: null, packaged: true });
  assert.equal(none.OPENROUTER_API_KEY, undefined);
  assert.equal(none.CHAT_OPENROUTER_API_KEY, undefined);
  assert.equal(none.OTHER, 'ok');
  const own = localOpenRouterEnvironment({ environment: parent, userKey: 'own', packaged: true });
  assert.equal(own.OPENROUTER_API_KEY, 'own');
  assert.equal(own.CHAT_OPENROUTER_API_KEY, 'own');
  assert.equal(parent.OPENROUTER_API_KEY, 'parent');
});

test('development backend retains explicit environment when no desktop key is set', () => {
  const result = localOpenRouterEnvironment({ environment: { OPENROUTER_API_KEY: 'dev' }, userKey: null, packaged: false });
  assert.equal(result.OPENROUTER_API_KEY, 'dev');
});
