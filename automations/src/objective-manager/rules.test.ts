import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decideAutoAdvanceAfterDelivery,
  deriveObjectiveLifecycleView,
  manageObjectiveLifecycle,
  type ObjectiveLifecycleObjective,
  planEnsureDraftSlot,
  shouldDiscardEmptiedObjective,
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
});
