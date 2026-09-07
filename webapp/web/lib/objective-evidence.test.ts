import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DeliveryDto, FileChangeDto, TerminalSessionDto } from '../../shared/contract.ts';

import {
  evidenceForObjective,
  formatObjectiveElapsed,
  hasUnassignedEvidence,
  objectiveHasHistory,
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
