import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDeliveryReport } from './delivery-report.js';
import {
  buildDeterministicMissionSummary,
  type MissionSummaryDeliveryEvidence,
  type MissionSummaryObjectiveEvidence,
  reconcileMissionSummaryDraft,
  selectMissionSummarySuggestions,
  splitMissionSummaryRuns
} from './mission-summary-compose.js';

function objective(
  id: string,
  overrides: Partial<MissionSummaryObjectiveEvidence> = {}
): MissionSummaryObjectiveEvidence {
  return {
    id,
    key: `coo:1.${id}`,
    title: `Objective ${id}`,
    state: 'complete',
    reopenedAt: null,
    deleted: false,
    ...overrides
  };
}

function delivery(
  id: string,
  objectiveId: string,
  deliveredAt: string,
  agentReport: {
    knownRisks?: string[];
    deferredWork?: Array<{ title: string; change: string; location: string; doneWhen: string }>;
  } = {}
): MissionSummaryDeliveryEvidence {
  const summary = `Delivery ${id} shipped. More detail follows.`;
  return {
    id,
    objectiveId,
    deliveredAt,
    summary,
    report: buildDeliveryReport({
      summary,
      deliveryReport: { schemaVersion: 1, agentReport: { humanActions: [], ...agentReport } }
    })
  };
}

function deferred(title: string) {
  return { title, change: `Change ${title}.`, location: 'src/a.ts', doneWhen: `${title} works.` };
}

describe('splitMissionSummaryRuns', () => {
  it('supersedes deliveries before a reopen and older deliveries of the same objective', () => {
    const objectives = [objective('a', { reopenedAt: '2026-10-20T12:00:00.000Z' }), objective('b')];
    const runs = splitMissionSummaryRuns({
      objectives,
      deliveries: [
        delivery('a-before-reopen', 'a', '2026-10-20T11:00:00.000Z'),
        delivery('a-current', 'a', '2026-10-20T13:00:00.000Z'),
        delivery('b-old', 'b', '2026-10-20T09:00:00.000Z'),
        delivery('b-new', 'b', '2026-10-20T14:00:00.000Z'),
        delivery('unassigned', 'deleted-objective', '2026-10-20T10:00:00.000Z')
      ]
    });
    assert.deepEqual(
      runs.currentRun.map(item => item.id),
      ['b-new', 'a-current', 'unassigned', 'b-old']
    );
    assert.deepEqual(
      runs.latestByObjective.map(item => item.id),
      ['b-new', 'a-current', 'unassigned']
    );
    assert.deepEqual(runs.superseded.map(item => item.id).sort(), ['a-before-reopen', 'b-old']);
  });

  it('keeps a delivery made exactly at the reopen boundary and breaks time ties by id', () => {
    const boundary = '2026-10-20T12:00:00.000Z';
    const runs = splitMissionSummaryRuns({
      objectives: [objective('a', { reopenedAt: boundary }), objective('b')],
      deliveries: [
        delivery('a-just-before', 'a', '2026-10-20T11:59:59.999Z'),
        delivery('a-at-boundary', 'a', boundary),
        delivery('b-1', 'b', boundary),
        delivery('b-3', 'b', boundary),
        delivery('b-2', 'b', boundary)
      ]
    });
    assert.deepEqual(
      runs.currentRun.map(item => item.id),
      ['b-3', 'b-2', 'b-1', 'a-at-boundary']
    );
    assert.deepEqual(
      runs.latestByObjective.map(item => item.id),
      ['b-3', 'a-at-boundary']
    );
    assert.deepEqual(runs.superseded.map(item => item.id).sort(), ['a-just-before', 'b-1', 'b-2']);
  });

  it('keeps suggestions and risks across every current-run delivery, newest first', () => {
    const objectives = [objective('a')];
    const older = delivery('older', 'a', '2026-10-20T09:00:00.000Z', {
      knownRisks: ['Old risk.'],
      deferredWork: [deferred('Shared item'), deferred('Dismissed item'), deferred('Older only')]
    });
    const newer = delivery('newer', 'a', '2026-10-20T10:00:00.000Z', {
      deferredWork: [deferred('shared   ITEM')]
    });
    const runs = splitMissionSummaryRuns({ objectives, deliveries: [older, newer] });
    const dismissedId = older.report.presentation.deferredWork[1]!.id;
    const suggestions = selectMissionSummarySuggestions({
      currentRun: runs.currentRun,
      resolutionStatus: new Map([[`older:${dismissedId}`, 'dismissed']])
    });
    assert.deepEqual(
      suggestions.map(ref => ref.deliveryId),
      ['newer', 'older'],
      'the newer duplicate wins and the dismissed item is hidden'
    );
    assert.equal(suggestions[1]!.actionId, older.report.presentation.deferredWork[2]!.id);

    const composed = reconcileMissionSummaryDraft({
      draft: {
        headline: 'Newer delivery shipped.',
        summary: 'The newer delivery shipped.',
        risks: [{ ref: 'older:0', text: 'Old risk, shortened.' }, { ref: 'invented:3' }]
      },
      objectives,
      runs,
      openQuestions: [],
      suggestions,
      model: 'gemini-test'
    });
    assert.equal(composed.status, 'composed');
    assert.deepEqual(composed.risks, [
      { deliveryId: 'older', objectiveId: 'a', index: 0, text: 'Old risk, shortened.' }
    ]);
  });
});

describe('deterministic fallback', () => {
  it('falls back when the draft is null and uses the newest delivery for the headline', () => {
    const objectives = [objective('a'), objective('b')];
    const runs = splitMissionSummaryRuns({
      objectives,
      deliveries: [
        delivery('a1', 'a', '2026-10-20T09:00:00.000Z', { knownRisks: ['Risk A.'] }),
        delivery('b1', 'b', '2026-10-20T10:00:00.000Z', { knownRisks: ['risk a.'] })
      ]
    });
    const result = reconcileMissionSummaryDraft({
      draft: null,
      objectives,
      runs,
      openQuestions: [],
      suggestions: [],
      model: 'gemini-test'
    });
    assert.equal(result.status, 'fallback');
    assert.equal(result.generatedBy, 'deterministic');
    assert.equal(result.model, null);
    assert.equal(result.headline, 'Delivery b1 shipped.');
    assert.equal(result.summary, 'Delivery b1 shipped. Delivery a1 shipped.');
    assert.deepEqual(
      result.risks.map(risk => risk.deliveryId),
      ['b1'],
      'risks are deduped by normalised text, newest kept'
    );
  });

  it('does not dereference a missing delivery before the first delivery', () => {
    const base = {
      runs: splitMissionSummaryRuns({ objectives: [], deliveries: [] }),
      suggestions: []
    };

    const question = buildDeterministicMissionSummary({
      ...base,
      objectives: [objective('a', { state: 'executing' })],
      openQuestions: [
        {
          requestId: 'r1',
          objectiveId: 'a',
          prompt: 'Which database?',
          createdAt: '2026-10-20T09:00:00.000Z'
        }
      ]
    });
    assert.equal(question.headline, 'An agent is waiting for your answer.');
    assert.equal(question.summary, 'Objective coo:1.a asks: Which database?');

    const running = buildDeterministicMissionSummary({
      ...base,
      objectives: [objective('a', { state: 'executing' })],
      openQuestions: []
    });
    assert.equal(running.headline, 'Objective coo:1.a is running.');

    const awaiting = buildDeterministicMissionSummary({
      ...base,
      objectives: [objective('a', { state: 'draft' })],
      openQuestions: []
    });
    assert.equal(awaiting.headline, 'No objective has delivered yet.');
    assert.deepEqual(awaiting.risks, []);
  });
});
