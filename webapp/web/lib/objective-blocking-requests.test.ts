import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type BlockingRequestLike,
  isPendingBlockingRequest
} from './objective-blocking-requests.ts';

function request(overrides: Partial<BlockingRequestLike> & { id: string }): BlockingRequestLike {
  return { kind: 'question', status: 'open', ...overrides };
}

test('only open question, choice and approval requests are pending', () => {
  assert.equal(isPendingBlockingRequest(request({ id: 'a' })), true);
  assert.equal(isPendingBlockingRequest(request({ id: 'b', kind: 'choice' })), true);
  assert.equal(isPendingBlockingRequest(request({ id: 'c', status: 'resolved' })), false);
  assert.equal(
    isPendingBlockingRequest(request({ id: 'd', status: 'released_to_terminal' })),
    false
  );
  assert.equal(isPendingBlockingRequest(request({ id: 'e', status: 'expired' })), false);
  assert.equal(isPendingBlockingRequest(request({ id: 'f', status: 'cancelled' })), false);
  // An approval opens only on a control-plane session (ADR 0094), where it blocks the agent.
  assert.equal(isPendingBlockingRequest(request({ id: 'g', kind: 'permission' })), true);
  assert.equal(
    isPendingBlockingRequest(request({ id: 'g2', kind: 'permission', status: 'resolved' })),
    false
  );
  assert.equal(isPendingBlockingRequest(request({ id: 'h', kind: 'retry' })), false);
});
