import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeQueuedObjectiveOrder } from './queued-objective-order.ts';

describe('mergeQueuedObjectiveOrder', () => {
  it('keeps the local order while a local reorder is pending', () => {
    const previousIds = ['queued-2', 'queued-1', 'queued-3'];
    const next = mergeQueuedObjectiveOrder({
      previousIds,
      incomingIds: ['queued-1', 'queued-2', 'queued-3'],
      reorderPending: true
    });
    assert.equal(next, previousIds);
    assert.deepEqual(next, ['queued-2', 'queued-1', 'queued-3']);
  });

  it('takes a server-side reorder when no local reorder is pending', () => {
    assert.deepEqual(
      mergeQueuedObjectiveOrder({
        previousIds: ['queued-1', 'queued-2', 'queued-3'],
        incomingIds: ['queued-2', 'queued-3', 'queued-1'],
        reorderPending: false
      }),
      ['queued-2', 'queued-3', 'queued-1']
    );
  });

  it('returns the same array when nothing changed', () => {
    const previousIds = ['queued-1', 'queued-2'];
    assert.equal(
      mergeQueuedObjectiveOrder({
        previousIds,
        incomingIds: ['queued-1', 'queued-2'],
        reorderPending: false
      }),
      previousIds
    );
  });

  it('places a reopened objective first when another one launched', () => {
    assert.deepEqual(
      mergeQueuedObjectiveOrder({
        previousIds: ['queued-1', 'queued-2', 'queued-3', 'queued-4'],
        incomingIds: ['reopened', 'queued-1', 'queued-2', 'queued-4'],
        reorderPending: false
      }),
      ['reopened', 'queued-1', 'queued-2', 'queued-4']
    );
  });

  it('appends a newly authored draft at the end of the server order', () => {
    assert.deepEqual(
      mergeQueuedObjectiveOrder({
        previousIds: ['queued-1', 'queued-2'],
        incomingIds: ['queued-1', 'queued-2', 'queued-3'],
        reorderPending: false
      }),
      ['queued-1', 'queued-2', 'queued-3']
    );
  });

  it('drops a deleted draft without reordering the rest', () => {
    assert.deepEqual(
      mergeQueuedObjectiveOrder({
        previousIds: ['queued-1', 'queued-2', 'queued-3'],
        incomingIds: ['queued-1', 'queued-3'],
        reorderPending: false
      }),
      ['queued-1', 'queued-3']
    );
  });
});
