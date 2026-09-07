import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeFutureObjectiveOrder } from './future-objective-order.ts';

describe('mergeFutureObjectiveOrder', () => {
  it('keeps the local order when membership is unchanged', () => {
    const previousIds = ['future-2', 'future-1', 'future-3'];
    const next = mergeFutureObjectiveOrder({
      previousIds,
      incomingIds: ['future-1', 'future-2', 'future-3']
    });
    assert.equal(next, previousIds);
    assert.deepEqual(next, ['future-2', 'future-1', 'future-3']);
  });

  it('places a demoted draft first when a future objective is promoted', () => {
    assert.deepEqual(
      mergeFutureObjectiveOrder({
        previousIds: ['future-1', 'future-2', 'future-3', 'future-4'],
        incomingIds: ['draft', 'future-1', 'future-2', 'future-4']
      }),
      ['draft', 'future-1', 'future-2', 'future-4']
    );
  });

  it('appends a newly authored future at the end of the server order', () => {
    assert.deepEqual(
      mergeFutureObjectiveOrder({
        previousIds: ['future-1', 'future-2'],
        incomingIds: ['future-1', 'future-2', 'future-3']
      }),
      ['future-1', 'future-2', 'future-3']
    );
  });

  it('drops a deleted future without reordering the rest', () => {
    assert.deepEqual(
      mergeFutureObjectiveOrder({
        previousIds: ['future-1', 'future-2', 'future-3'],
        incomingIds: ['future-1', 'future-3']
      }),
      ['future-1', 'future-3']
    );
  });
});
