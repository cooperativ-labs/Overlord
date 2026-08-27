import type { ServiceContext } from '../../packages/core/service/context.ts';
import { findActingDeviceExecutionTargetId } from '../../packages/core/service/execution-targets.ts';
import { resolveDefaultLocalTargetProvider } from '../../packages/core/service/local-target/default-registry.ts';
import {
  type ExecutionTargetRef,
  targetMetadata,
  UnavailableProvider
} from '../../packages/core/service/local-target/registry.ts';
import type { LocalTargetCapabilities } from '../../packages/core/service/local-target/types.ts';
import { parseLocalTargetMutation } from '../../packages/core/service/local-target-mutations.ts';
import { getProjectExecutionTargetSelection } from '../../packages/core/service/project-execution-target.ts';
import { recordRunnerBranchEvent } from '../branching/branch-activity.ts';
import { nowIso, recordChange } from '../db.ts';

import { createCompletionListenerFactory } from './local-target-completion-notify.ts';

/**
 * Resolve the capability provider for a project's selected execution target.
 *
 * Two rules live here so no route has to restate them:
 *
 * 1. **The backend is a control plane.** It is never itself a local target, so
 *    `callerExecutionTargetId` is deliberately null and the registry can only
 *    hand back the runner-queue transport or a typed unavailable provider —
 *    the WS-F3 invariant that the server never touches a linked checkout on its
 *    own filesystem.
 * 2. **The caller's own device serves itself.** When the selected target is the
 *    acting client's machine, the client already has a local-target bridge and
 *    should use it; queueing to that same machine's runner would be slower and
 *    would fail outright when no runner is installed. The resolver says
 *    `LOCAL_TARGET_REQUIRED`, which routes report as the long-standing
 *    `LOCAL_FILESYSTEM_UNAVAILABLE` prompting exactly that local execution.
 */
export async function resolveProjectLocalTargetProvider({
  ctx,
  projectId,
  missionId = null,
  executionTargetId = null,
  readTimeoutMs,
  writeTimeoutMs
}: {
  ctx: ServiceContext;
  projectId: string;
  missionId?: string | null;
  executionTargetId?: string | null;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
}): Promise<LocalTargetCapabilities> {
  const selection = await getProjectExecutionTargetSelection({ ctx, projectId });
  const requested = executionTargetId?.trim() || selection.selectedExecutionTargetId;
  const actingTargetId = await findActingDeviceExecutionTargetId({ ctx });
  if (requested !== null && requested === actingTargetId) {
    return new UnavailableProvider(
      targetMetadata({ executionTargetId: requested, type: 'local' }, 'fake'),
      'LOCAL_TARGET_REQUIRED',
      'This checkout is on the calling device; run the operation through its local target bridge.'
    );
  }
  const eligible = requested
    ? selection.eligibleTargets.find(entry => entry.executionTargetId === requested)
    : undefined;
  const target: ExecutionTargetRef = {
    executionTargetId: requested ?? null,
    type: eligible?.type ?? 'local',
    deviceLabel: eligible?.deviceLabel ?? null,
    // An id we cannot find among eligible targets is not reachable *for this
    // project*; say so rather than queueing work nothing will claim.
    reachable: requested ? (eligible?.reachable ?? false) : false
  };
  return resolveDefaultLocalTargetProvider({
    target,
    options: {
      callerExecutionTargetId: null,
      runnerQueue: {
        ctx,
        projectId,
        missionId,
        ...(readTimeoutMs === undefined ? {} : { readTimeoutMs }),
        ...(writeTimeoutMs === undefined ? {} : { writeTimeoutMs }),
        createCompletionListener: createCompletionListenerFactory()
      }
    }
  });
}

export async function recordBranchActionActivityFromMutation({
  ctx,
  requestId,
  summary
}: {
  /**
   * The execution request's own workspace context (resolved by the runner
   * layer from the request's `workspace_id`), so the activity is attributed to
   * the mission's workspace even when it is not the caller's active one
   * (coo:135).
   */
  ctx: ServiceContext;
  requestId: string;
  summary: string;
}): Promise<void> {
  const workspaceId = ctx.workspace.id;
  const row = (await ctx.db.get(
    `SELECT mission_id, project_id, metadata_json
       FROM execution_requests
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [requestId, workspaceId]
  )) as { mission_id: string | null; project_id: string; metadata_json: string } | undefined;
  // A capability call queued without a mission has no timeline to record onto.
  if (!row || row.mission_id === null) return;
  const missionId = row.mission_id;

  const mutation = parseLocalTargetMutation(row.metadata_json);
  const branchName =
    typeof mutation?.input.branchName === 'string' ? mutation.input.branchName : '';
  const baseBranch =
    typeof mutation?.input.baseBranch === 'string' ? mutation.input.baseBranch : '';

  await ctx.db.transaction(async tx => {
    const mission = (await tx.get(
      `SELECT revision FROM missions WHERE id = ? AND workspace_id = ?`,
      [missionId, workspaceId]
    )) as { revision: number } | undefined;
    const now = nowIso();
    if (mission) {
      const revision = mission.revision + 1;
      await tx.run(
        `UPDATE missions SET updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
        [now, revision, missionId, workspaceId]
      );
      await recordChange(
        {
          workspaceId,
          entityType: 'mission',
          entityId: missionId,
          operation: 'update',
          entityRevision: revision,
          projectId: row.project_id,
          missionId,
          changedFields: ['updated_at']
        },
        tx
      );
    }
    await recordRunnerBranchEvent(tx, {
      workspaceId,
      projectId: row.project_id,
      missionId,
      summary,
      payload: { branch: branchName, baseBranch },
      now
    });
  });
}
