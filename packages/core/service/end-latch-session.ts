import type { PostMissionsByIdTerminalSessionsEndResponse200 } from '@overlord/contract/api';
import { createHash } from 'node:crypto';

import { resolveDefaultLocalTargetProvider } from './local-target/default-registry.ts';
import { recordChange } from './change-feed.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { parseMetadataJson } from './execution-requests.ts';
import { providerSessionFromMetadata } from './latch-launch.ts';
import type { LatchSessionState } from './latch-session.ts';
import { dequeueObjectiveAttempt } from './objective-dequeue.ts';
import { getProjectExecutionTargetSelection } from './project-execution-target.ts';
import { launchSessionSnapshotFromMetadata } from './terminal-profile-types.ts';
import { recordTerminalObservation } from './terminal-session-lifecycle.ts';
import { newId, nowIso } from './util.ts';

type SessionRow = {
  id: string;
  project_id: string;
  objective_id: string;
  metadata_json: string;
  revision: number;
  claimed_by_execution_target_id: string | null;
  execution_target_id: string | null;
};

/** Called after mission-write authorization in the owning workspace. */
export async function endLatchSession({
  ctx,
  missionId,
  executionRequestId
}: {
  ctx: ServiceContext;
  missionId: string;
  executionRequestId: string;
}) {
  const db = ctx.db;
  const load = () =>
    db.get<SessionRow>(
      `SELECT id, project_id, objective_id, metadata_json, revision,
              claimed_by_execution_target_id, execution_target_id FROM execution_requests
      WHERE id = ? AND mission_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [executionRequestId, missionId, ctx.workspace.id]
    );
  const row = await load();
  const mapping = row && providerSessionFromMetadata(parseMetadataJson(row.metadata_json));
  if (!row || !mapping) throw new ServiceError('Terminal session not found', 'not_found', 404);

  const now = nowIso();
  const scope = 'api.mission.terminal-session.end';
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ missionId, executionRequestId }))
    .digest('hex');
  await db.run(
    `INSERT INTO idempotency_keys
      (id, workspace_id, scope, key, request_hash, status, actor_workspace_user_id,
       expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?)
      ON CONFLICT (workspace_id, scope, key) DO NOTHING`,
    [
      newId(),
      ctx.workspace.id,
      scope,
      executionRequestId,
      requestHash,
      ctx.actorWorkspaceUserId,
      new Date(Date.now() + 86400_000).toISOString(),
      now,
      now
    ]
  );
  const response = async (
    state: LatchSessionState,
    reason: PostMissionsByIdTerminalSessionsEndResponse200['reason'] = null
  ) => {
    const value: PostMissionsByIdTerminalSessionsEndResponse200 = {
      executionRequestId,
      providerSessionId: mapping.providerSessionId,
      state: state === 'exited' ? 'ended' : 'unconfirmed',
      lastObservedState: state,
      reason: state === 'exited' ? null : reason,
      message:
        state === 'exited'
          ? 'Session ended.'
          : 'Unable to confirm session ended. Reconnect the execution machine and retry.'
    };
    // Unconfirmed replies remain reconcilable. Never replay uncertainty forever.
    await db.run(
      `UPDATE idempotency_keys SET status = ?, response_json = ?, updated_at = ?
        WHERE workspace_id = ? AND scope = ? AND key = ?
          AND (status <> 'completed' OR ? = 'completed')`,
      [
        state === 'exited' ? 'completed' : 'in_progress',
        JSON.stringify(value),
        nowIso(),
        ctx.workspace.id,
        scope,
        executionRequestId,
        state === 'exited' ? 'completed' : 'in_progress'
      ]
    );
    return value;
  };
  if (mapping.lastObservedState === 'exited') return response('exited');

  // Fence off automatic scheduling before sending a stop. Historical terminals
  // must never disconnect a newer attempt of the same objective.
  await db.transaction(async tx => {
    const objective = await tx.get<{ state: string; revision: number }>(
      `SELECT state, revision FROM objectives WHERE id = ? AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM execution_requests newer
          JOIN execution_requests original ON original.id = ?
          WHERE newer.objective_id = objectives.id AND newer.deleted_at IS NULL
            AND newer.requested_source <> 'local_target_mutation'
            AND (newer.created_at > original.created_at
              OR (newer.created_at = original.created_at AND newer.id > original.id)))`,
      [row.objective_id, row.id]
    );
    if (!objective || !['launching', 'executing', 'pending_delivery'].includes(objective.state))
      return;
    const now = nowIso();
    const updated = await tx.run(
      `UPDATE objectives SET state = 'submitted', updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?`,
      [now, row.objective_id, objective.revision]
    );
    if (!updated.changes)
      throw new ServiceError(
        'Objective changed; retry ending the session',
        'terminal_session_conflict',
        409
      );
    await dequeueObjectiveAttempt({
      objectiveId: row.objective_id,
      projectId: row.project_id,
      missionId: missionId,
      ctx: { ...ctx, db: tx },
      reason: 'disconnected',
      newState: 'submitted',
      now
    });
    await recordChange({
      ctx: { ...ctx, db: tx },
      entityType: 'objective',
      entityId: row.objective_id,
      operation: 'update',
      entityRevision: objective.revision + 1,
      projectId: row.project_id,
      missionId: missionId,
      objectiveId: row.objective_id,
      changedFields: ['state']
    });
  });

  const persist = (state: LatchSessionState) =>
    recordTerminalObservation({
      ctx,
      executionRequestId,
      providerSessionId: mapping.providerSessionId,
      state
    });

  const selection = await getProjectExecutionTargetSelection({ ctx, projectId: row.project_id });
  const target = selection.eligibleTargets.find(
    t =>
      t.executionTargetId ===
      (mapping.executionTargetId ?? row.claimed_by_execution_target_id ?? row.execution_target_id)
  );
  if (!target?.reachable) return response(await persist('lost'), 'target_offline');
  const provider = resolveDefaultLocalTargetProvider({
    target: {
      executionTargetId: target.executionTargetId,
      type: target.type,
      deviceLabel: target.deviceLabel,
      reachable: target.reachable
    },
    options: {
      callerExecutionTargetId: null,
      runnerQueue: {
        ctx,
        projectId: row.project_id,
        missionId: missionId,
        operationId: `end-terminal:${row.id}`,
        writeTimeoutMs: 30_000
      }
    }
  });
  const snapshot = launchSessionSnapshotFromMetadata(parseMetadataJson(row.metadata_json));
  const input = {
    providerSessionId: mapping.providerSessionId,
    executable: snapshot?.executionProvider?.executable ?? 'latch'
  };
  // Inspect independently on each retry: a previous stop may have completed
  // after its request timed out. Reuse the original stop job if still needed.
  const inspectionProvider = resolveDefaultLocalTargetProvider({
    target: { executionTargetId: target.executionTargetId, type: target.type, reachable: true },
    options: {
      callerExecutionTargetId: null,
      runnerQueue: { ctx, projectId: row.project_id, missionId: missionId }
    }
  });
  const inspection = await inspectionProvider.inspectLatchSession(input);
  if (inspection.ok && inspection.value.state === 'exited')
    return response(await persist('exited'));
  if (!inspection.ok || inspection.value.state === 'lost') {
    return response(await persist('lost'), 'session_unreachable');
  }
  // Persist human intent before dispatch; the background observer may win the exit race.
  await recordTerminalObservation({
    ctx,
    executionRequestId,
    providerSessionId: mapping.providerSessionId,
    state: inspection.value.state,
    requestEnd: true
  });
  const stopped = await provider.stopLatchSession(input);
  const observed = stopped.ok ? stopped.value.state : 'lost';
  const state = await persist(observed);
  return response(
    state,
    state === 'exited' ? null : stopped.ok ? 'stop_unconfirmed' : 'session_unreachable'
  );
}
