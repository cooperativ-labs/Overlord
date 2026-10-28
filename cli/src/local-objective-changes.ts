import {
  CAPTURE_GAP_CODES,
  type CaptureBindingState,
  type CaptureWarningCode,
  type LocalFileChangeDto,
  type LocalObjectiveChangesDto,
  OBJECTIVE_FILE_CHANGES_LIMIT
} from '@overlord/contract';

import type { ChangeLedgerSnapshot } from './change-ledger.js';

const MAX_LOCAL_HEALTH_CODES = 32;
const BINDING_SEVERITY: Record<CaptureBindingState, number> = { bound: 0, unknown: 1, unbound: 2 };

/** Health codes are stored as `code` or `code:count`; gap detection uses the bare code. */
function bareHealthCode(code: string): string {
  const separator = code.indexOf(':');
  return separator === -1 ? code : code.slice(0, separator);
}

/**
 * Fold the ledgers of every locally known session of one objective into the
 * CLI-local read. Rows are deduplicated by path (one working directory is one
 * resource), native provenance wins over a declaration, and a path is pending
 * while any session still holds it unsynchronized. Warnings are derived per
 * session so a newer healthy session never hides an earlier gap. Callers take
 * the snapshots before any finalization can remove a ledger.
 */
export function buildLocalObjectiveChanges({
  objectiveId,
  snapshots,
  syncFailed,
  unavailableDiagnosis = 'objective_binding_missing_in_working_directory'
}: {
  objectiveId: string;
  snapshots: ChangeLedgerSnapshot[];
  syncFailed: boolean;
  unavailableDiagnosis?: string;
}): LocalObjectiveChangesDto {
  if (snapshots.length === 0) {
    return {
      scope: 'local_objective_sessions',
      objectiveId,
      coverage: 'unavailable',
      items: [],
      total: 0,
      limit: OBJECTIVE_FILE_CHANGES_LIMIT,
      truncated: false,
      sync: { synced: 0, pending: 0, failed: syncFailed },
      capture: {
        bindingState: 'unknown',
        callbackObserved: false,
        healthCodes: [unavailableDiagnosis]
      },
      warnings: ['unknown_binding']
    };
  }

  const byPath = new Map<string, LocalFileChangeDto>();
  for (const snapshot of snapshots) {
    for (const entry of snapshot.evidence) {
      const syncState = entry.syncedAt ? 'synced' : 'pending';
      const current = byPath.get(entry.filePath);
      if (!current) {
        byPath.set(entry.filePath, {
          filePath: entry.filePath,
          source: entry.source,
          observedAt: entry.observedAt,
          hookHealth: entry.hookHealth ?? null,
          syncState
        });
        continue;
      }
      const newer = entry.observedAt > current.observedAt;
      byPath.set(entry.filePath, {
        filePath: entry.filePath,
        source:
          current.source === 'declared_edit' || entry.source === 'declared_edit'
            ? 'declared_edit'
            : 'agent_declared',
        observedAt: newer ? entry.observedAt : current.observedAt,
        hookHealth: newer ? (entry.hookHealth ?? null) : current.hookHealth,
        syncState: current.syncState === 'pending' || syncState === 'pending' ? 'pending' : 'synced'
      });
    }
  }
  const rows = [...byPath.values()].sort((left, right) =>
    left.filePath < right.filePath ? -1 : left.filePath > right.filePath ? 1 : 0
  );
  const pending = rows.filter(row => row.syncState === 'pending').length;

  const warnings = new Set<CaptureWarningCode>();
  const healthCodes = new Set<string>();
  let bindingState: CaptureBindingState = 'bound';
  let callbackObserved = false;
  for (const snapshot of snapshots) {
    const { capture } = snapshot;
    if (BINDING_SEVERITY[capture.bindingState] > BINDING_SEVERITY[bindingState]) {
      bindingState = capture.bindingState;
    }
    if (capture.callbackObservedAt) callbackObserved = true;
    if (capture.bindingState === 'unbound') warnings.add('unbound');
    else if (capture.bindingState === 'unknown') warnings.add('unknown_binding');
    else if (!capture.callbackObservedAt) warnings.add('bound_no_callback');
    for (const entry of snapshot.health) {
      healthCodes.add(entry.code);
      if ((CAPTURE_GAP_CODES as readonly string[]).includes(bareHealthCode(entry.code))) {
        warnings.add('tool_activity_uncaptured');
      }
    }
  }
  if (pending > 0) warnings.add(syncFailed ? 'sync_failed' : 'sync_pending');

  return {
    scope: 'local_objective_sessions',
    objectiveId,
    coverage: 'available',
    items: rows.slice(0, OBJECTIVE_FILE_CHANGES_LIMIT),
    total: rows.length,
    limit: OBJECTIVE_FILE_CHANGES_LIMIT,
    truncated: rows.length > OBJECTIVE_FILE_CHANGES_LIMIT,
    sync: { synced: rows.length - pending, pending, failed: syncFailed },
    capture: {
      bindingState,
      callbackObserved,
      healthCodes: [...healthCodes].sort().slice(0, MAX_LOCAL_HEALTH_CODES)
    },
    warnings: [...warnings]
  };
}
