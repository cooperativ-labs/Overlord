/** Shared disconnect/completion cleanup. Caller owns the transaction. */
import { recordChange } from './change-feed.ts';
import type { ServiceContext } from './context.ts';
import { clearExecutionRequests } from './execution-requests.ts';
import { removeRunQueueEntryForObjective } from './run-queue.ts';
import { newId } from './util.ts';

export async function dequeueObjectiveAttempt({
  objectiveId,
  projectId,
  missionId,
  ctx,
  reason,
  newState,
  now
}: {
  objectiveId: string;
  projectId: string;
  missionId: string;
  ctx: ServiceContext;
  /** Why the objective left the queue, for the audit event payload. */
  reason: 'completed' | 'disconnected' | 'deleted';
  /** New objective state, or null when the objective is being deleted. */
  newState: string | null;
  now: string;
}): Promise<{ clearedRequests: number; endedSessions: number }> {
  const tx = ctx.db;
  const workspaceId = ctx.workspace.id;
  const workspaceUserId = ctx.actorWorkspaceUserId;
  // Drop the queue entry *before* clearing requests. An objective that has been
  // completed, disconnected, or deleted has no queue membership left to plan,
  // and clearing its request first would reconcile the still-live entry back to
  // `waiting('retry_pending')` — a hold on work nobody is going to do. Removal
  // also enqueues its own dispatch tick. A forced disconnect is an intentional
  // intervention point, however, so it pauses that queue transactionally and
  // cannot release the following objective.
  await removeRunQueueEntryForObjective(tx, projectId, objectiveId, {
    pauseQueue: reason === 'disconnected',
    preserveObjectivePositions: true
  });

  const { cleared } = await clearExecutionRequests({
    ctx,
    objectiveId,
    now,
    emitEvents: false,
    includeLaunched: true
  });

  // A completed objective ends its session cleanly; a disconnect/delete leaves
  // it blocked since the agent never reached a delivery.
  const sessionPhase = newState === 'complete' ? 'complete' : 'blocked';
  const openSessions = await tx.all<{ id: string; revision: number }>(
    `SELECT id, revision FROM agent_sessions
        WHERE workspace_id = ? AND objective_id = ? AND deleted_at IS NULL
          AND ended_at IS NULL`,
    [workspaceId, objectiveId]
  );

  for (const session of openSessions) {
    const revision = session.revision + 1;
    await tx.run(
      `UPDATE agent_sessions
         SET phase = ?, ended_at = ?, updated_at = ?, revision = ?
       WHERE id = ? AND workspace_id = ?`,
      [sessionPhase, now, now, revision, session.id, workspaceId]
    );
    await recordChange({
      ctx,
      entityType: 'agent_session',
      entityId: session.id,
      operation: 'update',
      entityRevision: revision,
      projectId,
      missionId,
      objectiveId,
      changedFields: ['phase', 'ended_at']
    });
  }

  if (cleared > 0 || openSessions.length > 0) {
    await tx.run(
      `INSERT INTO mission_events
         (id, workspace_id, project_id, mission_id, objective_id, type, phase, summary,
          payload_json, source, actor_workspace_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'status_change', NULL, ?, ?, 'webapp', ?, ?)`,
      [
        newId(),
        workspaceId,
        projectId,
        missionId,
        objectiveId,
        `Objective ${reason}: cleared ${cleared} delegated execution request(s) ` +
          `and ended ${openSessions.length} active session(s).`,
        JSON.stringify({
          reason,
          newState,
          clearedRequests: cleared,
          endedSessions: openSessions.length
        }),
        workspaceUserId,
        now
      ]
    );
  }

  return { clearedRequests: cleared, endedSessions: openSessions.length };
}
