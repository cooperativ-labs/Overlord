import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeQueueEntry, MAX_DISPATCH_ATTEMPTS } from './queue-entry-status.ts';

test('a mission-busy hold reads as waiting, not blocked, and names the sibling', () => {
  const status = describeQueueEntry({
    state: 'waiting',
    blockedReason: null,
    waitingReason: 'mission_busy',
    waitingOnObjectiveDisplayId: 'coo:854.9hm5'
  });

  assert.equal(status.label, 'Waiting');
  assert.equal(status.tone, 'neutral');
  assert.equal(status.detail, 'Waiting for coo:854.9hm5 to finish');
  assert.equal(status.waitingOnObjectiveDisplayId, 'coo:854.9hm5');
  assert.equal(status.canRetry, false);
});

test('a mission-busy hold with no sibling id still avoids amber', () => {
  const status = describeQueueEntry({
    state: 'waiting',
    blockedReason: null,
    waitingReason: 'mission_busy'
  });

  assert.equal(status.tone, 'neutral');
  assert.equal(status.detail, 'Waiting for another objective in this mission to finish');
  assert.equal(status.waitingOnObjectiveDisplayId, null);
});

test('a disconnected resource reads as waiting for the reconnect', () => {
  const status = describeQueueEntry({
    state: 'waiting',
    blockedReason: null,
    waitingReason: 'resource_disconnected'
  });

  assert.equal(status.tone, 'neutral');
  assert.equal(status.detail, 'Waiting for its resource to reconnect');
});

test('a pending retry counts the upcoming attempt and keeps the failure detail', () => {
  const status = describeQueueEntry({
    state: 'waiting',
    blockedReason: 'dispatch_failed: runner refused the claim',
    waitingReason: 'retry_pending',
    attemptCount: 1
  });

  assert.equal(status.label, 'Retrying');
  assert.equal(status.tone, 'neutral');
  assert.equal(status.detail, `Retrying (2/${MAX_DISPATCH_ATTEMPTS})`);
  assert.equal(status.detailNote, 'runner refused the claim');
  assert.equal(status.canRetry, false);
});

test('the retry counter never claims an attempt past the ceiling', () => {
  const status = describeQueueEntry({
    state: 'waiting',
    blockedReason: null,
    waitingReason: 'retry_pending',
    attemptCount: 9
  });

  assert.equal(status.detail, `Retrying (${MAX_DISPATCH_ATTEMPTS}/${MAX_DISPATCH_ATTEMPTS})`);
});

test('a plain waiting entry is simply next in line', () => {
  const status = describeQueueEntry({ state: 'waiting', blockedReason: null, waitingReason: null });

  assert.deepEqual(
    { label: status.label, tone: status.tone, detail: status.detail },
    { label: 'Waiting', tone: 'neutral', detail: null }
  );
});

test('blocked reasons are phrased as the action a human must take', () => {
  assert.equal(
    describeQueueEntry({ state: 'blocked', blockedReason: 'no_agent' }).detail,
    'Assign an agent'
  );
  assert.equal(
    describeQueueEntry({ state: 'blocked', blockedReason: 'no_instruction' }).detail,
    'Add instructions'
  );
  for (const reason of ['no_agent', 'no_instruction'] as const) {
    const status = describeQueueEntry({ state: 'blocked', blockedReason: reason });
    assert.equal(status.tone, 'blocked');
    assert.equal(status.canRetry, false);
  }
});

test('spent attempts offer Retry and keep the detail of the failure that spent them', () => {
  for (const kind of ['dispatch_failed', 'request_failed'] as const) {
    const status = describeQueueEntry({
      state: 'blocked',
      blockedReason: `${kind}: launch timed out`
    });
    assert.equal(status.label, 'Blocked');
    assert.equal(status.tone, 'blocked');
    assert.equal(status.detail, `Launch failed ${MAX_DISPATCH_ATTEMPTS}× — Retry`);
    assert.equal(status.detailNote, 'launch timed out');
    assert.equal(status.canRetry, true);
  }
});

test('an unrecognized blocked reason is still shown rather than swallowed', () => {
  const status = describeQueueEntry({ state: 'blocked', blockedReason: 'something_new' });

  assert.equal(status.tone, 'blocked');
  assert.equal(status.detail, 'something new');
});

test('in-flight entries are sky-toned and carry no hold copy', () => {
  assert.deepEqual(
    (['dispatched', 'running'] as const).map(state => {
      const status = describeQueueEntry({ state, blockedReason: null });
      return [status.label, status.tone, status.detail];
    }),
    [
      ['In flight', 'in_flight', null],
      ['Running', 'in_flight', null]
    ]
  );
});
