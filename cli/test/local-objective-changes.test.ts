import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChangeLedgerSnapshot } from '../src/change-ledger.ts';
import { buildLocalObjectiveChanges } from '../src/local-objective-changes.ts';

const AT = '2026-10-24T10:00:00.000Z';
const LATER = '2026-10-24T11:00:00.000Z';

function snapshot(partial: Partial<ChangeLedgerSnapshot>): ChangeLedgerSnapshot {
  return { evidence: [], health: [], capture: { bindingState: 'bound' }, ...partial };
}

test('local read deduplicates sessions, keeps native provenance, and caps at 200', () => {
  const older = snapshot({
    capture: { bindingState: 'unbound' },
    health: [{ at: AT, code: 'direct_path_unavailable' }],
    evidence: [
      {
        idempotencyKey: 'a',
        filePath: 'src/shared.ts',
        source: 'declared_edit',
        observedAt: AT,
        syncedAt: AT
      },
      ...Array.from({ length: 210 }, (_, index) => ({
        idempotencyKey: `bulk-${index}`,
        filePath: `zz/${String(index).padStart(3, '0')}.ts`,
        source: 'agent_declared' as const,
        observedAt: AT,
        syncedAt: AT
      }))
    ]
  });
  const newer = snapshot({
    capture: { bindingState: 'bound', callbackObservedAt: AT },
    evidence: [
      {
        idempotencyKey: 'b',
        filePath: 'src/shared.ts',
        source: 'agent_declared',
        observedAt: LATER,
        hookHealth: 'agent_declared'
      }
    ]
  });

  const local = buildLocalObjectiveChanges({
    objectiveId: 'objective-1',
    snapshots: [older, newer],
    syncFailed: false
  });

  assert.equal(local.scope, 'local_objective_sessions');
  assert.equal(local.coverage, 'available');
  assert.equal(local.total, 211);
  assert.equal(local.items.length, 200);
  assert.equal(local.limit, 200);
  assert.equal(local.truncated, true);
  const shared = local.items.find(item => item.filePath === 'src/shared.ts');
  assert.deepEqual(shared, {
    filePath: 'src/shared.ts',
    source: 'declared_edit',
    observedAt: LATER,
    hookHealth: 'agent_declared',
    syncState: 'pending'
  });
  assert.deepEqual(local.sync, { synced: 210, pending: 1, failed: false });
  // The newer healthy session never hides the earlier unbound gap.
  assert.equal(local.capture.bindingState, 'unbound');
  assert.equal(local.capture.callbackObserved, true);
  assert.deepEqual(local.warnings.sort(), ['sync_pending', 'tool_activity_uncaptured', 'unbound']);
});

test('local read without a matching session is unavailable coverage', () => {
  const local = buildLocalObjectiveChanges({
    objectiveId: 'objective-1',
    snapshots: [],
    syncFailed: false
  });
  assert.equal(local.coverage, 'unavailable');
  assert.equal(local.total, 0);
  assert.deepEqual(local.warnings, ['unknown_binding']);
  assert.deepEqual(local.capture.healthCodes, ['objective_binding_missing_in_working_directory']);
});

test('bound session without a callback and failed sync are reported', () => {
  const local = buildLocalObjectiveChanges({
    objectiveId: 'objective-1',
    snapshots: [
      snapshot({
        evidence: [
          { idempotencyKey: 'x', filePath: 'a.ts', source: 'declared_edit', observedAt: AT }
        ]
      })
    ],
    syncFailed: true
  });
  assert.deepEqual(local.warnings.sort(), ['bound_no_callback', 'sync_failed']);
  assert.equal(local.sync.failed, true);
});
