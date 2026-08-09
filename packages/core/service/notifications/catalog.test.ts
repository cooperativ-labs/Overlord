import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
  notificationTypesForTransport
} from './catalog.ts';

test('catalog exposes every notification type with trusted presentation metadata', () => {
  assert.deepEqual(Object.keys(NOTIFICATION_CATALOG).sort(), [...NOTIFICATION_TYPES].sort());
  for (const [id, descriptor] of Object.entries(NOTIFICATION_CATALOG)) {
    assert.equal(descriptor.id, id);
    assert.ok(descriptor.label);
    assert.ok(descriptor.detail);
    assert.ok(descriptor.verb);
  }
});

test('APNs categories remain the four existing wire values', () => {
  assert.deepEqual(notificationTypesForTransport('apns'), [
    'mission_awaiting_review',
    'agent_question',
    'mission_complete',
    'mission_failed'
  ]);
});
