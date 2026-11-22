/**
 * Latch terminal-session surface: list persistent terminals and forget a
 * provider mapping after Latch reports that the session is absent.
 */
import { PERMISSIONS } from '@overlord/auth';
import type { TerminalSessionDto } from '@overlord/contract';

import { asRecord } from '../../packages/core/service/execution-requests.ts';
import { forgetLatchProviderSession } from '../../packages/core/service/latch-provider-session.ts';
import { terminalMetadataSql } from '../../packages/core/service/terminal-session-lifecycle.ts';
import {
  projectTerminalSession,
  type TerminalSessionProjectionRow
} from '../../packages/core/service/terminal-session-projection.ts';
import { buildWebappServiceContextForWorkspace, requireDatabaseClient } from '../db.ts';
import { ApiError } from '../errors.ts';
import { requireMissionPermission } from '../rbac.ts';

const endedSql = () =>
  `(COALESCE(${terminalMetadataSql(requireDatabaseClient().dialect, 'lastObservedState')}, '') = 'exited' OR COALESCE(${terminalMetadataSql(requireDatabaseClient().dialect, 'lastObservedState', true)}, '') = 'exited')`;
const columns = `er.id AS execution_request_id, er.objective_id, er.metadata_json,
  er.created_at, er.updated_at, et.label AS target_label, d.label AS device_label`;
const joins = `FROM execution_requests er
  LEFT JOIN execution_targets et ON et.id = COALESCE(er.claimed_by_execution_target_id, er.execution_target_id)
  LEFT JOIN devices d ON d.id = et.device_id`;

/** Existing live list plus at most five recent ended terminals. */
export async function listMissionTerminalSessions(
  missionId: string
): Promise<TerminalSessionDto[]> {
  const db = requireDatabaseClient();
  const [live, ended] = await Promise.all([
    db.all<TerminalSessionProjectionRow>(
      `SELECT ${columns} ${joins}
      WHERE er.mission_id = ? AND er.deleted_at IS NULL AND NOT (${endedSql()})
      AND ${terminalMetadataSql(requireDatabaseClient().dialect, 'provider')} = 'latch'
      ORDER BY er.created_at DESC, er.id DESC`,
      [missionId]
    ),
    db.all<TerminalSessionProjectionRow>(
      `SELECT ${columns} ${joins}
      WHERE er.mission_id = ? AND er.deleted_at IS NULL AND ${terminalMetadataSql(requireDatabaseClient().dialect, 'lastObservedState')} = 'exited'
      ORDER BY er.created_at DESC, er.id DESC LIMIT 5`,
      [missionId]
    )
  ]);
  return [...live, ...ended].map(row => projectTerminalSession(row)).filter(row => row !== null);
}

/** Ended-only history, newest launch first, with a mission-scoped keyset cursor. */
export async function readMissionTerminalHistory(
  missionRef: string,
  query: Record<string, unknown>
) {
  const scope = await requireMissionPermission({
    missionRef,
    permission: PERMISSIONS.MISSION_READ
  });
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new ApiError(400, 'limit must be an integer between 1 and 100');
  const db = requireDatabaseClient();
  let cursor: { created_at: string; id: string } | undefined;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string') throw new ApiError(400, 'Invalid cursor');
    cursor = await db.get<{ created_at: string; id: string }>(
      `SELECT id, created_at FROM execution_requests er WHERE er.id = ? AND er.mission_id = ?
        AND er.workspace_id = ? AND er.deleted_at IS NULL AND ${endedSql()}`,
      [query.cursor, scope.missionId, scope.workspaceId]
    );
    if (!cursor) throw new ApiError(400, 'Invalid cursor');
  }
  const rows = await db.all<TerminalSessionProjectionRow>(
    `SELECT ${columns} ${joins}
    WHERE er.mission_id = ? AND er.workspace_id = ? AND er.deleted_at IS NULL AND ${endedSql()}
    ${cursor ? 'AND (er.created_at < ? OR (er.created_at = ? AND er.id < ?))' : ''}
    ORDER BY er.created_at DESC, er.id DESC LIMIT ?`,
    [
      scope.missionId,
      scope.workspaceId,
      ...(cursor ? [cursor.created_at, cursor.created_at, cursor.id] : []),
      limit + 1
    ]
  );
  return {
    sessions: rows
      .slice(0, limit)
      .map(row => projectTerminalSession(row, true))
      .filter(row => row !== null),
    nextCursor: rows.length > limit ? rows[limit - 1]!.execution_request_id : null
  };
}

export async function forgetMissionLatchSession(
  missionRef: string,
  body: unknown
): Promise<Record<string, unknown>> {
  // Forgetting rewrites the execution request's session metadata, so it needs
  // the session write action, not only read access.
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
