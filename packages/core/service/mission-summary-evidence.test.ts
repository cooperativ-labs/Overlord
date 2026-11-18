import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDeliveryReport } from './delivery-report.js';
import {
  type MissionSummaryDeliveryEvidence,
  type MissionSummaryObjectiveEvidence,
  splitMissionSummaryRuns
} from './mission-summary-evidence.js';

function objective(
  id: string,
  overrides: Partial<MissionSummaryObjectiveEvidence> = {}
): MissionSummaryObjectiveEvidence {
  return { id, reopenedAt: null, ...overrides };
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
});
