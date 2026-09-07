import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DeliveryDto, FileChangeDto, TerminalSessionDto } from '../../shared/contract.ts';

import {
  evidenceForObjective,
  formatObjectiveElapsed,
  groupEvidenceByRun,
  hasUnassignedEvidence,
  objectiveHasHistory,
  objectiveRunLabel,
  partitionMissionEvidence
} from './objective-evidence.ts';

function delivery(overrides: Partial<DeliveryDto> & { id: string }): DeliveryDto {
  return {
    missionId: 'mission-1',
    objectiveId: 'obj-1',
    sessionId: null,
    summary: 'Done.',
    verificationSummary: null,
    followUpNotes: null,
    report: {} as DeliveryDto['report'],
    deliveredAt: '2026-08-30T10:00:00.000Z',
    agentIdentifier: null,
    modelIdentifier: null,
    ...overrides
  };
}

function fileChange(overrides: Partial<FileChangeDto> & { id: string }): FileChangeDto {
  return {
    missionId: 'mission-1',
    objectiveId: 'obj-1',
    filePath: 'src/index.ts',
    fileName: 'index.ts',
    label: null,
    summary: null,
    why: null,
    impact: null,
    vcsStatus: null,
    source: null,
    quality: null,
    overlap: false,
    hookHealth: null,
    resourceKey: null,
    createdAt: '2026-08-30T10:00:00.000Z',
    ...overrides
  };
}

function session(
  overrides: Partial<TerminalSessionDto> & { providerSessionId: string }
): TerminalSessionDto {
  return {
    executionRequestId: `req-${overrides.providerSessionId}`,
    objectiveId: 'obj-1',
    provider: 'latch',
    sessionName: overrides.providerSessionId,
    executionTargetId: 'target-1',
    deviceLabel: 'Mac',
    agentSessionId: null,
    executable: 'latch',
    viewerKind: 'iterm',
    createdAt: '2026-08-30T09:00:00.000Z',
    lastObservedState: 'running',
    ...overrides
  };
}

test('groups every evidence kind under its objective, newest first', () => {
  const partition = partitionMissionEvidence({
    objectives: [{ id: 'obj-1' }, { id: 'obj-2' }],
    deliveries: [
      delivery({ id: 'd-old', deliveredAt: '2026-08-30T10:00:00.000Z' }),
      delivery({ id: 'd-new', deliveredAt: '2026-08-31T10:00:00.000Z' }),
      delivery({ id: 'd-other', objectiveId: 'obj-2' })
    ],
    fileChanges: [
      fileChange({ id: 'f-old', createdAt: '2026-08-30T10:00:00.000Z' }),
      fileChange({ id: 'f-new', createdAt: '2026-08-30T11:00:00.000Z' })
    ],
    terminalSessions: [
      session({ providerSessionId: 's-old', createdAt: '2026-08-30T09:00:00.000Z' }),
      session({ providerSessionId: 's-new', createdAt: '2026-08-31T09:00:00.000Z' })
    ]
  });

  const first = evidenceForObjective(partition, 'obj-1');
  assert.deepEqual(
    first.deliveries.map(item => item.id),
    ['d-new', 'd-old']
  );
  assert.deepEqual(
    first.fileChanges.map(item => item.id),
    ['f-new', 'f-old']
  );
  assert.deepEqual(
    first.terminalSessions.map(item => item.providerSessionId),
    ['s-new', 's-old']
  );

  const second = evidenceForObjective(partition, 'obj-2');
  assert.deepEqual(
    second.deliveries.map(item => item.id),
    ['d-other']
  );
  assert.equal(second.fileChanges.length, 0);
  assert.equal(second.terminalSessions.length, 0);
  assert.equal(hasUnassignedEvidence(partition), false);
});

test('routes evidence with no live objective to the unassigned bucket', () => {
  const partition = partitionMissionEvidence({
    objectives: [{ id: 'obj-1' }],
    deliveries: [delivery({ id: 'orphan', objectiveId: 'deleted-objective' })],
    fileChanges: [fileChange({ id: 'kept' })]
  });

  assert.equal(hasUnassignedEvidence(partition), true);
  assert.deepEqual(
    partition.unassigned.deliveries.map(item => item.id),
    ['orphan']
  );
  assert.equal(evidenceForObjective(partition, 'obj-1').fileChanges.length, 1);
});

test('reports an empty record for an objective that produced nothing', () => {
  const partition = partitionMissionEvidence({ objectives: [{ id: 'obj-1' }] });
  const evidence = evidenceForObjective(partition, 'obj-1');
  assert.equal(evidence.objectiveId, 'obj-1');
  assert.equal(objectiveHasHistory(evidence), false);
  // Unknown objectives are also empty rather than undefined, so callers never branch on absence.
  assert.equal(objectiveHasHistory(evidenceForObjective(partition, 'nope')), false);
  assert.equal(objectiveHasHistory(evidenceForObjective(null, 'nope')), false);
});

test('objectiveHasHistory is true for any single evidence kind', () => {
  const base = { objectiveId: 'obj-1', deliveries: [], fileChanges: [], terminalSessions: [] };
  assert.equal(objectiveHasHistory({ ...base, deliveries: [delivery({ id: 'd' })] }), true);
  assert.equal(objectiveHasHistory({ ...base, fileChanges: [fileChange({ id: 'f' })] }), true);
  assert.equal(
    objectiveHasHistory({ ...base, terminalSessions: [session({ providerSessionId: 's' })] }),
    true
  );
});

test('formats elapsed time compactly and refuses missing or inverted ranges', () => {
  assert.equal(
    formatObjectiveElapsed({
      startedAt: '2026-08-30T10:00:00.000Z',
      completedAt: '2026-08-30T10:14:20.000Z'
    }),
    '14m'
  );
  assert.equal(
    formatObjectiveElapsed({
      startedAt: '2026-08-30T10:00:00.000Z',
      completedAt: '2026-08-30T12:05:00.000Z'
    }),
    '2h 05m'
  );
  assert.equal(
    formatObjectiveElapsed({
      startedAt: '2026-08-30T10:00:00.000Z',
      completedAt: '2026-09-02T14:00:00.000Z'
    }),
    '3d 4h'
  );
  assert.equal(
    formatObjectiveElapsed({
      startedAt: '2026-08-30T10:00:00.000Z',
      completedAt: '2026-08-30T10:00:10.000Z'
    }),
    '<1m'
  );
  assert.equal(formatObjectiveElapsed({ startedAt: null, completedAt: '2026-08-30' }), null);
  assert.equal(
    formatObjectiveElapsed({
      startedAt: '2026-08-31T10:00:00.000Z',
      completedAt: '2026-08-30T10:00:00.000Z'
    }),
    null
  );
});

// ---- run boundaries (contract v133) -------------------------------------

function evidenceOf({
  deliveries = [],
  fileChanges = [],
  terminalSessions = []
}: {
  deliveries?: DeliveryDto[];
  fileChanges?: FileChangeDto[];
  terminalSessions?: TerminalSessionDto[];
}) {
  return evidenceForObjective(
    partitionMissionEvidence({
      objectives: [{ id: 'obj-1' }],
      deliveries,
      fileChanges,
      terminalSessions
    }),
    'obj-1'
  );
}

test('splits evidence at reopenedAt: rows at or after it are the latest run', () => {
  const evidence = evidenceOf({
    deliveries: [
      delivery({ id: 'd-run1', deliveredAt: '2026-08-30T10:00:00.000Z' }),
      delivery({ id: 'd-run2', deliveredAt: '2026-09-02T10:00:00.000Z' })
    ],
    fileChanges: [
      fileChange({ id: 'f-run1', createdAt: '2026-08-30T09:30:00.000Z' }),
      fileChange({ id: 'f-boundary', createdAt: '2026-09-01T12:00:00.000Z' }),
      fileChange({ id: 'f-run2', createdAt: '2026-09-02T09:00:00.000Z' })
    ],
    terminalSessions: [
      session({ providerSessionId: 's-run1', createdAt: '2026-08-30T09:00:00.000Z' }),
      session({ providerSessionId: 's-run2', createdAt: '2026-09-01T12:30:00.000Z' })
    ]
  });

  const runs = groupEvidenceByRun(evidence, { reopenedAt: '2026-09-01T12:00:00.000Z' });
  assert.equal(runs.length, 2);
  const [latest, earlier] = runs;
  assert.deepEqual(
    { number: latest!.number, total: latest!.total, latest: latest!.latest },
    { number: 2, total: 2, latest: true }
  );
  assert.deepEqual(
    latest!.deliveries.map(item => item.id),
    ['d-run2']
  );
  assert.deepEqual(
    latest!.fileChanges.map(item => item.id),
    ['f-run2', 'f-boundary']
  );
  assert.deepEqual(
    latest!.terminalSessions.map(item => item.providerSessionId),
    ['s-run2']
  );
  assert.deepEqual(
    { number: earlier!.number, total: earlier!.total, latest: earlier!.latest },
    { number: 1, total: 2, latest: false }
  );
  assert.deepEqual(
    earlier!.deliveries.map(item => item.id),
    ['d-run1']
  );
  assert.deepEqual(
    earlier!.fileChanges.map(item => item.id),
    ['f-run1']
  );
  assert.deepEqual(
    earlier!.terminalSessions.map(item => item.providerSessionId),
    ['s-run1']
  );
  assert.equal(objectiveRunLabel(latest!), 'Run 2 of 2');
  assert.equal(objectiveRunLabel(earlier!), 'Run 1 of 2');
});

test('a run with no delivery, or with two, is still one run when reopenedAt is set', () => {
  // Run 1 delivered twice (a follow-up re-attach); run 2 was abandoned before
  // delivering. Delivery-order inference would have called this three runs.
  const evidence = evidenceOf({
    deliveries: [
      delivery({ id: 'd-first', deliveredAt: '2026-08-30T10:00:00.000Z' }),
      delivery({ id: 'd-follow-up', deliveredAt: '2026-08-30T15:00:00.000Z' })
    ],
    fileChanges: [fileChange({ id: 'f-run2', createdAt: '2026-09-02T09:00:00.000Z' })],
    terminalSessions: [
      session({ providerSessionId: 's-run1', createdAt: '2026-08-30T09:00:00.000Z' }),
      session({ providerSessionId: 's-run2', createdAt: '2026-09-02T08:00:00.000Z' })
    ]
  });

  const runs = groupEvidenceByRun(evidence, { reopenedAt: '2026-09-01T00:00:00.000Z' });
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0]!.deliveries, []);
  assert.deepEqual(
    runs[0]!.fileChanges.map(item => item.id),
    ['f-run2']
  );
  assert.deepEqual(
    runs[1]!.deliveries.map(item => item.id),
    ['d-follow-up', 'd-first']
  );
  assert.deepEqual(
    runs[1]!.terminalSessions.map(item => item.providerSessionId),
    ['s-run1']
  );
});

test('a reverted draft drops its not-yet-started latest run and keeps the earlier one', () => {
  const evidence = evidenceOf({
    deliveries: [delivery({ id: 'd-run1', deliveredAt: '2026-08-30T10:00:00.000Z' })],
    fileChanges: [fileChange({ id: 'f-run1', createdAt: '2026-08-30T09:30:00.000Z' })]
  });
  const reopenedAt = '2026-09-01T12:00:00.000Z';

  const history = groupEvidenceByRun(evidence, { reopenedAt }, { keepEmptyLatest: false });
  assert.equal(history.length, 1);
  assert.deepEqual(
    { number: history[0]!.number, total: history[0]!.total, latest: history[0]!.latest },
    { number: 1, total: 1, latest: true }
  );
  assert.equal(objectiveRunLabel(history[0]!), null);

  // A completed objective keeps the empty latest run so its empty states render.
  const complete = groupEvidenceByRun(evidence, { reopenedAt });
  assert.equal(complete.length, 2);
  assert.equal(complete[0]!.latest, true);
  assert.deepEqual(complete[0]!.deliveries, []);
  assert.deepEqual(
    complete[1]!.deliveries.map(item => item.id),
    ['d-run1']
  );
});

test('falls back to delivery-order inference when reopenedAt is null', () => {
  const evidence = evidenceOf({
    deliveries: [
      delivery({ id: 'd-run1', deliveredAt: '2026-08-30T10:00:00.000Z' }),
      delivery({ id: 'd-run2', deliveredAt: '2026-09-02T10:00:00.000Z' })
    ],
    fileChanges: [
      fileChange({ id: 'f-run1', createdAt: '2026-08-30T09:30:00.000Z' }),
      fileChange({ id: 'f-run2', createdAt: '2026-09-02T09:00:00.000Z' }),
      fileChange({ id: 'f-after', createdAt: '2026-09-03T09:00:00.000Z' })
    ],
    terminalSessions: [
      session({ providerSessionId: 's-run1', createdAt: '2026-08-30T09:00:00.000Z' }),
      session({ providerSessionId: 's-run2', createdAt: '2026-09-02T08:00:00.000Z' })
    ]
  });

  const runs = groupEvidenceByRun(evidence, { reopenedAt: null });
  assert.equal(runs.length, 2);
  assert.deepEqual(
    runs[0]!.deliveries.map(item => item.id),
    ['d-run2']
  );
  // Rows newer than the last delivery belong to the latest run.
  assert.deepEqual(
    runs[0]!.fileChanges.map(item => item.id),
    ['f-after', 'f-run2']
  );
  assert.deepEqual(
    runs[0]!.terminalSessions.map(item => item.providerSessionId),
    ['s-run2']
  );
  assert.deepEqual(
    runs[1]!.deliveries.map(item => item.id),
    ['d-run1']
  );
  assert.deepEqual(
    runs[1]!.fileChanges.map(item => item.id),
    ['f-run1']
  );
  assert.deepEqual(
    runs[1]!.terminalSessions.map(item => item.providerSessionId),
    ['s-run1']
  );
  assert.equal(objectiveRunLabel(runs[1]!), 'Run 1 of 2');
});

test('without a boundary and at most one delivery everything is a single run', () => {
  const single = groupEvidenceByRun(
    evidenceOf({
      deliveries: [delivery({ id: 'd' })],
      fileChanges: [fileChange({ id: 'f' })],
      terminalSessions: [session({ providerSessionId: 's' })]
    }),
    { reopenedAt: null }
  );
  assert.equal(single.length, 1);
  assert.equal(single[0]!.deliveries.length, 1);
  assert.equal(single[0]!.fileChanges.length, 1);
  assert.equal(single[0]!.terminalSessions.length, 1);
  assert.equal(objectiveRunLabel(single[0]!), null);

  const nothing = groupEvidenceByRun(evidenceOf({}), { reopenedAt: null });
  assert.equal(nothing.length, 1);
  assert.equal(objectiveHasHistory({ objectiveId: 'obj-1', ...nothing[0]! }), false);
  assert.deepEqual(
    groupEvidenceByRun(evidenceOf({}), { reopenedAt: null }, { keepEmptyLatest: false }),
    []
  );
});
