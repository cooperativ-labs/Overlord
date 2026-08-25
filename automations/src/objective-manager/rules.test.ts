import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decideAutoAdvanceAfterDelivery,
  deriveObjectiveLifecycleView,
  manageObjectiveLifecycle,
  type ObjectiveLifecycleObjective,
  objectiveResourcesConflict,
  planEnsureDraftSlot,
  planRunQueueDispatch,
  shouldDiscardEmptiedObjective,
  siblingBlocksParallelLaunch,
  sortObjectivesForMissionDisplay,
  validateObjectiveLifecycle
} from './index.js';

function objective(
  overrides: Partial<ObjectiveLifecycleObjective> & Pick<ObjectiveLifecycleObjective, 'id'>
): ObjectiveLifecycleObjective {
  return {
    position: 0,
    state: 'future',
    instructionText: 'Do work',
    autoAdvance: false,
    assignedAgent: null,
    ...overrides
  };
}

describe('objective lifecycle rules', () => {
  it('derives the ordered UI groups without embedding rules in the component', () => {
    const view = deriveObjectiveLifecycleView([
      objective({ id: 'future-1', position: 3, state: 'future' }),
      objective({ id: 'done', position: 0, state: 'complete' }),
      objective({ id: 'next', position: 2, state: 'submitted' }),
      objective({ id: 'active', position: 1, state: 'executing' })
    ]);

    assert.deepEqual(
      view.orderedObjectives.map(item => item.id),
      ['done', 'active', 'next', 'future-1']
    );
    assert.deepEqual(
      view.executedObjectives.map(item => item.id),
      ['done', 'active']
    );
    assert.deepEqual(
      view.editableObjectives.map(item => item.id),
      ['next']
    );
    assert.deepEqual(
      view.futureObjectives.map(item => item.id),
      ['future-1']
    );
  });

  it('orders the mission list by lifecycle moment, not queue position', () => {
    const ordered = sortObjectivesForMissionDisplay([
      objective({ id: 'future-1', position: 0, state: 'future' }),
      objective({ id: 'draft', position: 1, state: 'draft' }),
      objective({
        id: 'launched-second',
        position: 2,
        state: 'launching',
        launchedAt: '2026-08-21T10:00:00.000Z'
      }),
      objective({
        id: 'launched-first',
        position: 3,
        state: 'launching',
        launchedAt: '2026-08-21T09:00:00.000Z'
      }),
      objective({
        id: 'started-second',
        position: 4,
        state: 'pending_delivery',
        startedAt: '2026-08-21T08:00:00.000Z'
      }),
      objective({
        id: 'started-first',
        position: 5,
        state: 'executing',
        startedAt: '2026-08-21T07:00:00.000Z'
      }),
      objective({
        id: 'done-second',
        position: 6,
        state: 'complete',
        completedAt: '2026-08-21T06:00:00.000Z'
      }),
      objective({
        id: 'done-first',
        position: 7,
        state: 'complete',
        completedAt: '2026-08-21T05:00:00.000Z'
      })
    ]);

    assert.deepEqual(
      ordered.map(item => item.id),
      [
        'done-first',
        'done-second',
        'started-first',
        'started-second',
        'launched-first',
        'launched-second',
        'draft',
        'future-1'
      ]
    );
  });

  it('falls back to position when a lifecycle moment was never recorded', () => {
    const ordered = sortObjectivesForMissionDisplay([
      objective({ id: 'untimed-b', position: 3, state: 'complete' }),
      objective({ id: 'untimed-a', position: 1, state: 'complete' }),
      objective({
        id: 'timed',
        position: 2,
        state: 'complete',
        completedAt: '2026-08-21T05:00:00.000Z'
      })
    ]);

    // Timestamped rows lead; untimestamped ones keep their position order behind
    // them instead of shuffling on every render.
    assert.deepEqual(
      ordered.map(item => item.id),
      ['timed', 'untimed-a', 'untimed-b']
    );
  });

  it('keeps the render groups as contiguous slices of the display order', () => {
    const view = deriveObjectiveLifecycleView([
      objective({ id: 'future-1', position: 0, state: 'future' }),
      objective({
        id: 'launching',
        position: 1,
        state: 'launching',
        launchedAt: '2026-08-21T10:00:00.000Z'
      }),
      objective({ id: 'draft', position: 2, state: 'draft' }),
      objective({
        id: 'active',
        position: 3,
        state: 'executing',
        startedAt: '2026-08-21T09:00:00.000Z'
      }),
      objective({
        id: 'done',
        position: 4,
        state: 'complete',
        completedAt: '2026-08-21T08:00:00.000Z'
      })
    ]);

    assert.deepEqual(
      view.orderedObjectives.map(item => item.id),
      ['done', 'active', 'launching', 'draft', 'future-1']
    );
    assert.deepEqual(
      [
        ...view.executedObjectives.map(item => item.id),
        ...view.editableObjectives.map(item => item.id),
        ...view.futureObjectives.map(item => item.id)
      ],
      view.orderedObjectives.map(item => item.id)
    );
  });

  it('reports lifecycle invariant violations', () => {
    const violations = validateObjectiveLifecycle([
      objective({ id: 'draft-1', position: 0, state: 'draft' }),
      objective({ id: 'draft-2', position: 0, state: 'draft' }),
      objective({ id: 'executing', position: 2, state: 'executing' }),
      objective({ id: 'pending', position: 3, state: 'pending_delivery' }),
      objective({ id: 'blank', position: 4, state: 'complete', instructionText: '   ' })
    ]);

    assert.deepEqual(
      violations.map(violation => violation.code),
      [
        'multiple_drafts',
        'multiple_active_objectives',
        'duplicate_position',
        'blank_instruction_after_draft'
      ]
    );
  });

  it('plans draft-slot refill by promoting a future objective, never by creating a blank one', () => {
    assert.deepEqual(
      planEnsureDraftSlot([
        objective({ id: 'done', position: 0, state: 'complete', assignedAgent: 'codex' }),
        objective({ id: 'future', position: 1, state: 'future' })
      ]),
      { action: 'promote_future', objectiveId: 'future' }
    );

    // With nothing authored to promote, the empty next-up slot is the client's
    // unsaved composer, so the planner persists nothing.
    assert.deepEqual(
      planEnsureDraftSlot([
        objective({ id: 'done', position: 0, state: 'complete', assignedAgent: 'codex' })
      ]),
      { action: 'none', reason: 'no_future_objective' }
    );

    // A legacy blank future row is not work to promote either — the planner has
    // to agree with the `TRIM(instruction_text) <> ''` guard in the backend and
    // core refill queries, or the two would disagree about the same mission.
    assert.deepEqual(
      planEnsureDraftSlot([
        objective({ id: 'done', position: 0, state: 'complete' }),
        objective({ id: 'blank-future', position: 1, state: 'future', instructionText: '  ' })
      ]),
      { action: 'none', reason: 'no_future_objective' }
    );

    // ...but an authored future objective behind the blank one still refills it.
    assert.deepEqual(
      planEnsureDraftSlot([
        objective({ id: 'blank-future', position: 0, state: 'future', instructionText: '' }),
        objective({ id: 'authored', position: 1, state: 'future' })
      ]),
      { action: 'promote_future', objectiveId: 'authored' }
    );
  });

  it('discards an emptied draft or future objective instead of keeping a blank row', () => {
    for (const state of ['draft', 'future'] as const) {
      assert.equal(
        shouldDiscardEmptiedObjective(objective({ id: state, state, instructionText: '   ' })),
        true,
        `${state} objective emptied of text should be discarded`
      );
    }

    // Attachments are real work, so the objective survives without text.
    assert.equal(
      shouldDiscardEmptiedObjective(objective({ id: 'with-file', state: 'future' }), {
        attachmentCount: 1
      }),
      false
    );

    // Text present — nothing to discard, whatever the state.
    assert.equal(
      shouldDiscardEmptiedObjective(objective({ id: 'authored', state: 'draft' })),
      false
    );

    // Objectives past the editable slot are history and are never removed by an
    // empty commit, even if their text somehow reads blank.
    for (const state of ['submitted', 'launching', 'executing', 'complete'] as const) {
      assert.equal(
        shouldDiscardEmptiedObjective(objective({ id: state, state, instructionText: '' })),
        false,
        `${state} objective must not be discarded`
      );
    }
  });

  it('keeps pre-attach submitted or launching objectives in the next-up slot', () => {
    assert.deepEqual(
      planEnsureDraftSlot([objective({ id: 'queued', position: 0, state: 'submitted' })]),
      { action: 'none', reason: 'next_up_still_launching' }
    );
    assert.deepEqual(
      planEnsureDraftSlot([objective({ id: 'launching', position: 0, state: 'launching' })]),
      { action: 'none', reason: 'next_up_still_launching' }
    );
  });

  it('decides post-delivery auto-advance policy for the next draft', () => {
    assert.deepEqual(
      decideAutoAdvanceAfterDelivery([
        objective({ id: 'done', position: 0, state: 'complete' }),
        objective({
          id: 'next',
          position: 1,
          state: 'draft',
          autoAdvance: true,
          assignedAgent: 'codex'
        })
      ]),
      { action: 'queue_launch', objectiveId: 'next', idempotencyKey: 'auto_advance:next' }
    );

    assert.deepEqual(
      decideAutoAdvanceAfterDelivery([
        objective({ id: 'next', position: 0, state: 'draft', autoAdvance: false })
      ]),
      {
        action: 'await_approval',
        objectiveId: 'next',
        reason: 'Next objective is waiting for approval.'
      }
    );
  });

  it('exposes a registry-friendly automation output', () => {
    const output = manageObjectiveLifecycle({
      objectives: [
        objective({ id: 'done', position: 0, state: 'complete' }),
        objective({ id: 'next', position: 1, state: 'draft' }),
        objective({ id: 'future', position: 2, state: 'future' })
      ],
      planAutoAdvance: true
    });

    assert.deepEqual(output.orderedObjectiveIds, ['done', 'next', 'future']);
    assert.deepEqual(output.editableObjectiveIds, ['next']);
    assert.deepEqual(output.futureObjectiveIds, ['future']);
    assert.equal(output.autoAdvanceDecision?.action, 'await_approval');
  });

  it('allows two active objectives on different resources when parallel is opted in', () => {
    const violations = validateObjectiveLifecycle(
      [
        objective({
          id: 'a',
          position: 0,
          state: 'executing',
          resourceKey: 'primary'
        }),
        objective({
          id: 'b',
          position: 1,
          state: 'executing',
          resourceKey: 'docs'
        })
      ],
      { allowParallelObjectives: true, primaryResourceKey: 'primary' }
    );
    assert.equal(
      violations.some(violation => violation.code === 'multiple_active_objectives'),
      false
    );
  });

  it('allows two active objectives on the same resource when parallel is opted in', () => {
    // Phase E: same-resource concurrency is legal. The Runner Layer gives each
    // objective its own branch/worktree when the mission uses worktrees, and a
    // worktree-less mission has one checkout that both deliberately share.
    const violations = validateObjectiveLifecycle(
      [
        objective({ id: 'a', position: 0, state: 'executing', resourceKey: null }),
        objective({ id: 'b', position: 1, state: 'pending_delivery', resourceKey: 'primary' })
      ],
      { allowParallelObjectives: true, primaryResourceKey: 'primary' }
    );
    assert.equal(
      violations.some(violation => violation.code === 'multiple_active_objectives'),
      false
    );
  });

  it('still reports multiple_active_objectives when parallel is off', () => {
    const violations = validateObjectiveLifecycle([
      objective({ id: 'a', position: 0, state: 'executing', resourceKey: 'docs' }),
      objective({ id: 'b', position: 1, state: 'pending_delivery', resourceKey: 'primary' })
    ]);
    assert.deepEqual(
      violations
        .filter(violation => violation.code === 'multiple_active_objectives')
        .map(v => v.code),
      ['multiple_active_objectives']
    );
  });

  it('blocks a sibling launch only while parallel objectives are off', () => {
    assert.equal(
      siblingBlocksParallelLaunch({
        allowParallelObjectives: false,
        candidateResourceKey: 'docs',
        siblingResourceKey: 'primary'
      }),
      true
    );
    assert.equal(
      siblingBlocksParallelLaunch({
        allowParallelObjectives: true,
        candidateResourceKey: 'docs',
        siblingResourceKey: 'primary'
      }),
      false
    );
    // Same effective resource, flag on: allowed since Phase E.
    assert.equal(
      siblingBlocksParallelLaunch({
        allowParallelObjectives: true,
        candidateResourceKey: null,
        siblingResourceKey: 'overlord',
        primaryResourceKey: 'overlord'
      }),
      false
    );
  });

  it('objectiveResourcesConflict still answers "same checkout?" for isolation callers', () => {
    assert.equal(
      objectiveResourcesConflict({ left: null, right: 'overlord', primaryResourceKey: 'overlord' }),
      true
    );
    assert.equal(
      objectiveResourcesConflict({
        left: 'docs',
        right: 'overlord',
        primaryResourceKey: 'overlord'
      }),
      false
    );
  });

  it('plans independent queue heads and skips held entries', () => {
    const actions = planRunQueueDispatch({
      queues: [
        { id: 'a', paused: false },
        { id: 'b', paused: false },
        { id: 'paused', paused: true }
      ],
      entries: [
        {
          id: 'held',
          queueId: 'a',
          objectiveId: 'held-objective',
          position: 1,
          state: 'waiting',
          attemptCount: 0
        },
        {
          id: 'next',
          queueId: 'a',
          objectiveId: 'next-objective',
          position: 2,
          state: 'waiting',
          attemptCount: 0
        },
        {
          id: 'parallel',
          queueId: 'b',
          objectiveId: 'future-objective',
          position: 1,
          state: 'waiting',
          attemptCount: 0
        },
        {
          id: 'paused-entry',
          queueId: 'paused',
          objectiveId: 'paused-objective',
          position: 1,
          state: 'waiting',
          attemptCount: 0
        }
      ],
      objectives: {
        'held-objective': {
          id: 'held-objective',
          missionId: 'mission-held',
          state: 'draft',
          instructionText: 'held',
          resourceConnected: false
        },
        'next-objective': {
          id: 'next-objective',
          missionId: 'mission-next',
          state: 'draft',
          instructionText: 'next'
        },
        'future-objective': {
          id: 'future-objective',
          missionId: 'mission-future',
          state: 'future',
          instructionText: 'parallel'
        },
        'paused-objective': {
          id: 'paused-objective',
          missionId: 'mission-paused',
          state: 'draft',
          instructionText: 'paused'
        }
      }
    });
    assert.deepEqual(actions, [
      { action: 'wait', entryId: 'held', reason: 'resource_disconnected' },
      {
        action: 'dispatch',
        entryId: 'next',
        objectiveId: 'next-objective',
        promoteFutureToDraft: false,
        idempotencyKey: 'run_queue:next:attempt:1'
      },
      {
        action: 'dispatch',
        entryId: 'parallel',
        objectiveId: 'future-objective',
        promoteFutureToDraft: true,
        idempotencyKey: 'run_queue:parallel:attempt:1'
      }
    ]);
  });

  it('blocks only once attempts are exhausted and scopes retries to a fresh attempt', () => {
    const held = planRunQueueDispatch({
      queues: [{ id: 'queue', paused: false }],
      entries: [
        {
          id: 'terminal',
          queueId: 'queue',
          objectiveId: 'failed-objective',
          position: 1,
          state: 'blocked',
          attemptCount: 1
        },
        {
          id: 'later',
          queueId: 'queue',
          objectiveId: 'later-objective',
          position: 2,
          state: 'waiting',
          attemptCount: 0
        }
      ],
      objectives: {
        'failed-objective': {
          id: 'failed-objective',
          missionId: 'mission-failed',
          state: 'launching',
          instructionText: 'failed'
        },
        'later-objective': {
          id: 'later-objective',
          missionId: 'mission-later',
          state: 'draft',
          instructionText: 'continue'
        }
      },
      maxDispatchAttempts: 1
    });
    assert.deepEqual(held, [
      { action: 'block', entryId: 'terminal', reason: 'dispatch_failed' },
      {
        action: 'dispatch',
        entryId: 'later',
        objectiveId: 'later-objective',
        promoteFutureToDraft: false,
        idempotencyKey: 'run_queue:later:attempt:1'
      }
    ]);

    const retry = planRunQueueDispatch({
      queues: [{ id: 'queue', paused: false }],
      entries: [
        {
          id: 'terminal',
          queueId: 'queue',
          objectiveId: 'failed-objective',
          position: 1,
          state: 'waiting',
          attemptCount: 1
        }
      ],
      objectives: {
        'failed-objective': {
          id: 'failed-objective',
          missionId: 'mission-failed',
          state: 'draft',
          instructionText: 'retry'
        }
      }
    });
    assert.deepEqual(retry, [
      {
        action: 'dispatch',
        entryId: 'terminal',
        objectiveId: 'failed-objective',
        promoteFutureToDraft: false,
        idempotencyKey: 'run_queue:terminal:attempt:2'
      }
    ]);
  });
  it('names the failure that spent the attempts when it blocks at the ceiling', () => {
    // A runner that keeps dying before it attaches and a dispatch that throws
    // before a request exists are different problems with different remedies,
    // so the block that ends three attempts must not call them both
    // `dispatch_failed`.
    const blocked = planRunQueueDispatch({
      queues: [{ id: 'queue', paused: false }],
      entries: [
        {
          id: 'entry',
          queueId: 'queue',
          objectiveId: 'objective',
          position: 1,
          state: 'waiting',
          attemptCount: 3,
          failureKind: 'request_failed'
        }
      ],
      objectives: {
        objective: {
          id: 'objective',
          missionId: 'mission',
          state: 'draft',
          instructionText: 'retry me'
        }
      }
    });
    assert.deepEqual(blocked, [{ action: 'block', entryId: 'entry', reason: 'request_failed' }]);
  });
  it('waits rather than blocks while a serial mission is busy, and releases when it frees', () => {
    const entry = {
      id: 'entry',
      queueId: 'queue',
      objectiveId: 'second',
      position: 1,
      state: 'waiting' as const,
      attemptCount: 0
    };
    const objectives = {
      second: {
        id: 'second',
        missionId: 'mission',
        state: 'draft',
        instructionText: 'second step',
        assignedAgent: 'claude-code'
      }
    };
    const busy = planRunQueueDispatch({
      queues: [{ id: 'queue', paused: false, position: 1 }],
      entries: [entry],
      objectives,
      missions: {
        mission: { allowParallelObjectives: false, busyObjectiveIds: ['first'] }
      }
    });
    assert.deepEqual(busy, [
      { action: 'wait', entryId: 'entry', reason: 'mission_busy', waitingOnObjectiveId: 'first' }
    ]);

    // The sibling delivered: nothing had to touch the entry for it to become
    // eligible again — the same snapshot without a lock holder dispatches it.
    const freed = planRunQueueDispatch({
      queues: [{ id: 'queue', paused: false, position: 1 }],
      entries: [entry],
      objectives,
      missions: { mission: { allowParallelObjectives: false, busyObjectiveIds: [] } }
    });
    assert.deepEqual(freed, [
      {
        action: 'dispatch',
        entryId: 'entry',
        objectiveId: 'second',
        promoteFutureToDraft: false,
        idempotencyKey: 'run_queue:entry:attempt:1'
      }
    ]);
  });

  it('dispatches a busy mission that allows parallel objectives', () => {
    const actions = planRunQueueDispatch({
      queues: [{ id: 'queue', paused: false, position: 1 }],
      entries: [
        {
          id: 'entry',
          queueId: 'queue',
          objectiveId: 'second',
          position: 1,
          state: 'waiting',
          attemptCount: 0
        }
      ],
      objectives: {
        second: {
          id: 'second',
          missionId: 'mission',
          state: 'draft',
          instructionText: 'second step',
          assignedAgent: 'claude-code'
        }
      },
      missions: { mission: { allowParallelObjectives: true, busyObjectiveIds: ['first'] } }
    });
    assert.deepEqual(actions, [
      {
        action: 'dispatch',
        entryId: 'entry',
        objectiveId: 'second',
        promoteFutureToDraft: false,
        idempotencyKey: 'run_queue:entry:attempt:1'
      }
    ]);
  });

  it('gives a serial mission to one queue per tick and lets a parallel mission flow to both', () => {
    const twoQueues = (allowParallelObjectives: boolean) =>
      planRunQueueDispatch({
        // Declared out of position order: the planner must sort, not trust input order.
        queues: [
          { id: 'later', paused: false, position: 2000 },
          { id: 'earlier', paused: false, position: 1000 }
        ],
        entries: [
          {
            id: 'in-later',
            queueId: 'later',
            objectiveId: 'objective-b',
            position: 1,
            state: 'waiting',
            attemptCount: 0
          },
          {
            id: 'in-earlier',
            queueId: 'earlier',
            objectiveId: 'objective-a',
            position: 1,
            state: 'waiting',
            attemptCount: 0
          }
        ],
        objectives: {
          'objective-a': {
            id: 'objective-a',
            missionId: 'mission',
            state: 'draft',
            instructionText: 'a',
            assignedAgent: 'claude-code'
          },
          'objective-b': {
            id: 'objective-b',
            missionId: 'mission',
            state: 'draft',
            instructionText: 'b',
            assignedAgent: 'claude-code'
          }
        },
        missions: { mission: { allowParallelObjectives, busyObjectiveIds: [] } }
      });

    assert.deepEqual(twoQueues(false), [
      {
        action: 'dispatch',
        entryId: 'in-earlier',
        objectiveId: 'objective-a',
        promoteFutureToDraft: false,
        idempotencyKey: 'run_queue:in-earlier:attempt:1'
      },
      {
        action: 'wait',
        entryId: 'in-later',
        reason: 'mission_busy',
        waitingOnObjectiveId: 'objective-a'
      }
    ]);
    assert.equal(
      twoQueues(true).every(action => action.action === 'dispatch'),
      true
    );
  });

  it('re-evaluates a blocked entry and releases it when its cause clears', () => {
    const entries = [
      {
        id: 'entry',
        queueId: 'queue',
        objectiveId: 'objective',
        position: 1,
        state: 'blocked' as const,
        attemptCount: 0
      }
    ];
    const stillBlocked = planRunQueueDispatch({
      queues: [{ id: 'queue', paused: false, position: 1 }],
      entries,
      objectives: {
        objective: {
          id: 'objective',
          missionId: 'mission',
          state: 'draft',
          instructionText: 'do the thing',
          assignedAgent: null
        }
      }
    });
    assert.deepEqual(stillBlocked, [{ action: 'block', entryId: 'entry', reason: 'no_agent' }]);

    const released = planRunQueueDispatch({
      queues: [{ id: 'queue', paused: false, position: 1 }],
      entries,
      objectives: {
        objective: {
          id: 'objective',
          missionId: 'mission',
          state: 'draft',
          instructionText: 'do the thing',
          assignedAgent: 'claude-code'
        }
      }
    });
    assert.deepEqual(released, [
      {
        action: 'dispatch',
        entryId: 'entry',
        objectiveId: 'objective',
        promoteFutureToDraft: false,
        idempotencyKey: 'run_queue:entry:attempt:1'
      }
    ]);
  });

  it('drops an entry for a gone objective in any non-in-flight state', () => {
    for (const state of ['waiting', 'blocked'] as const) {
      const actions = planRunQueueDispatch({
        queues: [{ id: 'queue', paused: false, position: 1 }],
        entries: [
          {
            id: `entry-${state}`,
            queueId: 'queue',
            objectiveId: 'objective',
            position: 1,
            state,
            attemptCount: 0
          }
        ],
        objectives: {
          objective: {
            id: 'objective',
            missionId: 'mission',
            state: 'complete',
            instructionText: 'done'
          }
        }
      });
      assert.deepEqual(actions, [
        { action: 'drop', entryId: `entry-${state}`, reason: 'objective_gone' }
      ]);
    }
  });
});
