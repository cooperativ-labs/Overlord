import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  blockingRequestLabel,
  type BlockingRequestLike,
  isPendingBlockingRequest,
  selectObjectiveBlockingRequests
} from './objective-blocking-requests.ts';

function request(overrides: Partial<BlockingRequestLike> & { id: string }): BlockingRequestLike {
  return { kind: 'question', status: 'open', ...overrides };
}

test('only open question and choice requests are pending', () => {
  assert.equal(isPendingBlockingRequest(request({ id: 'a' })), true);
  assert.equal(isPendingBlockingRequest(request({ id: 'b', kind: 'choice' })), true);
  assert.equal(isPendingBlockingRequest(request({ id: 'c', status: 'resolved' })), false);
  assert.equal(
    isPendingBlockingRequest(request({ id: 'd', status: 'released_to_terminal' })),
    false
  );
  assert.equal(isPendingBlockingRequest(request({ id: 'e', status: 'expired' })), false);
  assert.equal(isPendingBlockingRequest(request({ id: 'f', status: 'cancelled' })), false);
  assert.equal(isPendingBlockingRequest(request({ id: 'g', kind: 'permission' })), false);
  assert.equal(isPendingBlockingRequest(request({ id: 'h', kind: 'retry' })), false);
});

test('label names the kind when the set is homogeneous', () => {
  assert.equal(blockingRequestLabel([]), null);
  assert.match(blockingRequestLabel([request({ id: 'a' })]) ?? '', /a blocking question/);
  assert.match(
    blockingRequestLabel([request({ id: 'a' }), request({ id: 'b' })]) ?? '',
    /2 blocking questions/
  );
  assert.match(
    blockingRequestLabel([request({ id: 'a', kind: 'choice' })]) ?? '',
    /waiting on a choice/
  );
  assert.match(
    blockingRequestLabel([request({ id: 'a' }), request({ id: 'b', kind: 'choice' })]) ?? '',
    /2 agent requests/
  );
});

test('selects pending requests and reports the badge state', () => {
  const result = selectObjectiveBlockingRequests({
    requests: [
      request({ id: 'a' }),
      request({ id: 'b', kind: 'choice' }),
      request({ id: 'c', status: 'resolved' })
    ],
    dismissedIds: new Set()
  });
  assert.deepEqual(result.pendingIds, ['a', 'b']);
  assert.deepEqual(result.activeIds, ['a', 'b']);
  assert.equal(result.count, 2);
  assert.equal(result.isBlocking, true);
  assert.equal(typeof result.label, 'string');
});

test('dismissed ids stop blocking but stay pending', () => {
  const result = selectObjectiveBlockingRequests({
    requests: [request({ id: 'a' })],
    dismissedIds: new Set(['a'])
  });
  assert.deepEqual(result.pendingIds, ['a']);
  assert.deepEqual(result.activeIds, []);
  assert.equal(result.count, 0);
  assert.equal(result.isBlocking, false);
  assert.equal(result.label, null);
});

test('a new request re-arms the badge after an earlier dismissal', () => {
  const result = selectObjectiveBlockingRequests({
    requests: [request({ id: 'a' }), request({ id: 'b' })],
    dismissedIds: new Set(['a'])
  });
  assert.deepEqual(result.activeIds, ['b']);
  assert.equal(result.isBlocking, true);
});

test('no requests means nothing to show', () => {
  const result = selectObjectiveBlockingRequests({ requests: [], dismissedIds: new Set() });
  assert.deepEqual(result.pendingIds, []);
  assert.equal(result.count, 0);
  assert.equal(result.isBlocking, false);
  assert.equal(result.label, null);
});
