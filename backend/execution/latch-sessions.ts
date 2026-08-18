/**
 * Latch terminal-session observation surface: list persistent terminals for a
 * mission, ingest harness events, resolve pending input, and forget a session.
 */
import { PERMISSIONS } from '@overlord/auth';
import { launchSessionSnapshotFromMetadata } from '@overlord/core/service/terminal-profile-types';

import { asRecord, parseMetadataJson } from '../../packages/core/service/execution-requests.ts';
import { providerSessionFromMetadata } from '../../packages/core/service/latch-launch.ts';
import {
  clearLatchPendingInput,
  forgetLatchProviderSession,
  ingestLatchHarnessEvents
} from '../../packages/core/service/latch-observation.ts';
import type { TerminalSessionDto } from '../../webapp/shared/contract.ts';
import { buildWebappServiceContextForWorkspace, requireDatabaseClient } from '../db.ts';
import { ApiError } from '../errors.ts';
import { requireMissionPermission } from '../rbac.ts';

type TerminalSessionRow = {
  execution_request_id: string;
  objective_id: string;
  metadata_json: string;
  target_label: string | null;
  device_label: string | null;
};

function terminalSessionState(value: string): TerminalSessionDto['lastObservedState'] {
  switch (value) {
    case 'exited':
      return 'exited';
    case 'stopping':
      return 'stopping';
    case 'lost':
      return 'lost';
    default:
      return 'running';
  }
}

/** Every persistent terminal mapped to a mission, including completed objectives. */
export async function listMissionTerminalSessions(
  missionId: string
): Promise<TerminalSessionDto[]> {
  const rows = await requireDatabaseClient().all<TerminalSessionRow>(
    `SELECT er.id AS execution_request_id, er.objective_id, er.metadata_json,
            et.label AS target_label, d.label AS device_label
       FROM execution_requests er
       LEFT JOIN execution_targets et
         ON et.id = COALESCE(er.claimed_by_execution_target_id, er.execution_target_id)
       LEFT JOIN devices d ON d.id = et.device_id
      WHERE er.mission_id = ? AND er.deleted_at IS NULL
      ORDER BY er.created_at DESC`,
    [missionId]
  );
  return rows.flatMap(row => {
    const metadata = parseMetadataJson(row.metadata_json);
    const providerSession = providerSessionFromMetadata(metadata);
    if (!providerSession) return [];
    const snapshot = launchSessionSnapshotFromMetadata(metadata);
    return [
      {
        executionRequestId: row.execution_request_id,
        objectiveId: row.objective_id,
        provider: 'latch',
        providerSessionId: providerSession.providerSessionId,
        sessionName: providerSession.sessionName ?? providerSession.providerSessionId,
        executionTargetId: providerSession.executionTargetId,
        deviceLabel: row.device_label ?? row.target_label,
        agentSessionId: providerSession.agentSessionId,
        executable: snapshot?.executionProvider.executable ?? 'latch',
        viewerKind: snapshot?.viewer.kind ?? 'iterm',
        viewerOpenAs: snapshot?.viewer.openAs ?? 'window',
        createdAt: providerSession.createdAt,
        lastObservedState: terminalSessionState(providerSession.lastObservedState),
        observation: providerSession.observation
          ? {
              cursor: providerSession.observation.cursor,
              lastEventAt: providerSession.observation.lastEventAt,
              turnCount: providerSession.observation.turnCount,
              pendingInput: providerSession.observation.pendingInput,
              unattached: providerSession.observation.unattached
            }
          : null
      }
    ];
  });
}

export async function ingestMissionHarnessEvents(
  missionRef: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const scope = await requireMissionPermission({
    missionRef,
    permission: PERMISSIONS.SESSION_READ
  });
  const ctx = await buildWebappServiceContextForWorkspace(
    scope.workspaceId,
    requireDatabaseClient(),
    scope.workspaceUserId
  );
  const payload = asRecord(body);
  const providerSessionId =
    typeof payload.providerSessionId === 'string' ? payload.providerSessionId : '';
  const executionRequestId =
    typeof payload.executionRequestId === 'string' ? payload.executionRequestId : null;
  const events = Array.isArray(payload.events) ? payload.events : [];
  const from = typeof payload.from === 'number' ? payload.from : 0;
  return ingestLatchHarnessEvents({
    ctx,
    missionId: scope.missionId,
    executionRequestId,
    providerSessionId,
    events,
    from
  });
}

export async function resolveMissionLatchObservation(
  missionRef: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const scope = await requireMissionPermission({
    missionRef,
    permission: PERMISSIONS.SESSION_ATTACH
  });
  const ctx = await buildWebappServiceContextForWorkspace(
    scope.workspaceId,
    requireDatabaseClient(),
    scope.workspaceUserId
  );
  const payload = asRecord(body);
  const providerSessionId =
    typeof payload.providerSessionId === 'string' ? payload.providerSessionId : '';
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
  if (!providerSessionId.trim() || !requestId.trim()) {
    throw new ApiError(400, 'providerSessionId and requestId are required');
  }
  const observation = await clearLatchPendingInput({
    ctx,
    missionId: scope.missionId,
    providerSessionId,
    requestId
  });
  return { observation };
}

export async function forgetMissionLatchSession(
  missionRef: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const scope = await requireMissionPermission({
    missionRef,
    permission: PERMISSIONS.SESSION_READ
  });
  const ctx = await buildWebappServiceContextForWorkspace(
    scope.workspaceId,
    requireDatabaseClient(),
    scope.workspaceUserId
  );
  const payload = asRecord(body);
  const providerSessionId =
    typeof payload.providerSessionId === 'string' ? payload.providerSessionId : '';
  const executionRequestId =
    typeof payload.executionRequestId === 'string' ? payload.executionRequestId : null;
  if (!providerSessionId.trim()) {
    throw new ApiError(400, 'providerSessionId is required');
  }
  return forgetLatchProviderSession({
    ctx,
    missionId: scope.missionId,
    executionRequestId,
    providerSessionId
  });
}
