/** Confirmed terminal observations, independent of the logical agent session. */
import { recordChange } from './change-feed.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { parseMetadataJson } from './execution-requests.ts';
import { providerSessionFromMetadata } from './latch-launch.ts';
import type { LatchSessionState } from './latch-session.ts';
import { newId, nowIso } from './util.ts';

/** Trusted JSON paths shared by the SQLite and Postgres projections. */
export function terminalMetadataSql(dialect: string, field: string, archived = false): string {
  const key = archived ? 'endedTerminalSession' : 'providerSession';
  return dialect === 'postgres'
    ? `er.metadata_json->'${key}'->>'${field}'`
    : `json_extract(er.metadata_json, '$.${key}.${field}')`;
}

export async function recordTerminalObservation({
  ctx,
  executionRequestId,
  providerSessionId,
  state,
  endedAt,
  endReason,
  backgroundObservation,
  requestEnd = false
}: {
  ctx: ServiceContext;
  executionRequestId: string;
  providerSessionId: string;
  state: LatchSessionState;
  endedAt?: string | null;
  endReason?: string | null;
  backgroundObservation?: { executionTargetId: string | null; startedAt: string };
  requestEnd?: boolean;
}): Promise<LatchSessionState> {
  return ctx.db.transaction(async tx => {
    const row = await tx.get<{
      project_id: string;
      mission_id: string;
      objective_id: string;
      metadata_json: string;
      revision: number;
      target_id: string | null;
    }>(
      `SELECT project_id, mission_id, objective_id, metadata_json, revision,
              COALESCE(claimed_by_execution_target_id, execution_target_id) AS target_id
      FROM execution_requests WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [executionRequestId, ctx.workspace.id]
    );
    const metadata = row && parseMetadataJson(row.metadata_json);
    const mapping = metadata && providerSessionFromMetadata(metadata);
    if (!row || !metadata || !mapping || mapping.providerSessionId !== providerSessionId)
      throw new ServiceError('Terminal session changed', 'terminal_session_conflict', 409);
    if (mapping.lastObservedState === 'exited') return 'exited';
    if (backgroundObservation) {
      const currentState =
        mapping.lastObservedState === 'running' || mapping.lastObservedState === 'stopping'
          ? mapping.lastObservedState
          : 'lost';
      if ((mapping.executionTargetId ?? row.target_id) !== backgroundObservation.executionTargetId)
        return currentState;
      const { startedAt } = backgroundObservation;
      if (
        state !== 'exited' &&
        ((mapping.endRequestedAt && mapping.endRequestedAt > startedAt) ||
          (mapping.lastObservedAt &&
            (mapping.lastObservedAt > startedAt ||
              (mapping.lastObservedAt === startedAt &&
                (mapping.lastObservedState !== 'lost' || state === 'lost')))))
      )
        return currentState;
    }
    const now = nowIso();
    const next = {
      ...mapping,
      lastObservedState: state,
      lastObservedAt: backgroundObservation?.startedAt ?? now,
      ...(requestEnd ? { endRequestedAt: mapping.endRequestedAt ?? now } : {}),
      ...(state === 'exited'
        ? {
            endedAt:
              endedAt && Number.isFinite(Date.parse(endedAt))
                ? new Date(endedAt).toISOString()
                : now,
            endReason:
              mapping.endRequestedAt || requestEnd ? 'ended_by_person' : (endReason ?? 'exited')
          }
        : {})
    };
    metadata.providerSession = next;
    const updated = await tx.run(
      `UPDATE execution_requests SET metadata_json = ?,
      updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?`,
      [JSON.stringify(metadata), now, executionRequestId, row.revision]
    );
    if (!updated.changes)
      throw new ServiceError('Terminal session changed; retry', 'terminal_session_conflict', 409);
    // Refreshing observation time alone does not flood clients or timelines.
    if (mapping.lastObservedState === state) return state;
    await recordChange({
      ctx: { ...ctx, db: tx },
      entityType: 'execution_request',
      entityId: executionRequestId,
      operation: 'update',
      entityRevision: row.revision + 1,
      projectId: row.project_id,
      missionId: row.mission_id,
      objectiveId: row.objective_id,
      changedFields: ['metadata_json']
    });
    const eventId = newId();
    await tx.run(
      `INSERT INTO mission_events
      (id, workspace_id, project_id, mission_id, objective_id, type, phase, summary,
       payload_json, source, actor_workspace_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'status_change', NULL, ?, ?, ?, ?, ?)`,
      [
        eventId,
        ctx.workspace.id,
        row.project_id,
        row.mission_id,
        row.objective_id,
        state === 'exited' ? 'Terminal session ended.' : `Terminal session ${state}.`,
        JSON.stringify({
          executionRequestId,
          lastObservedState: state,
          endedAt: next.endedAt ?? null,
          endReason: next.endReason ?? null
        }),
        ctx.source,
        ctx.actorWorkspaceUserId,
        now
      ]
    );
    await recordChange({
      ctx: { ...ctx, db: tx },
      entityType: 'mission_event',
      entityId: eventId,
      operation: 'insert',
      projectId: row.project_id,
      missionId: row.mission_id,
      objectiveId: row.objective_id
    });
    return state;
  });
}
