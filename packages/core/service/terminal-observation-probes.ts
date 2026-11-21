import { createHash } from 'node:crypto';

import type { InspectLatchSessionResult } from './local-target/types.ts';
import { resolveProjectId, type ServiceContext } from './context.ts';
import { providerSessionFromMetadata } from './latch-launch.ts';
import {
  createLocalTargetMutationRequest,
  type LocalTargetMutationCompletionListenerFactory,
  waitForLocalTargetMutationResult
} from './local-target-mutations.ts';
import {
  TERMINAL_PROBE_RESULT_REUSE_MS,
  TERMINAL_PROBE_TIMEOUT_MS
} from './terminal-probe-policy.ts';
import { launchSessionSnapshotFromMetadata } from './terminal-profile-types.ts';

/** Called after the backend observer has checked this membership's target eligibility. */
export async function inspectTerminalInBackground({
  ctx,
  projectId,
  missionId,
  mappingId,
  providerSessionId,
  executionTargetId,
  eligibilityMember,
  createListener
}: {
  ctx: ServiceContext;
  projectId: string;
  missionId: string;
  mappingId: string;
  providerSessionId: string;
  executionTargetId: string;
  eligibilityMember: string;
  createListener?: LocalTargetMutationCompletionListenerFactory | null;
}) {
  await resolveProjectId(ctx, projectId);
  const job = await ctx.db.transaction(async tx => {
    // The mapping is the serialization point across backend replicas. SQLite
    // serializes transactions through its single local backend connection.
    const lock = tx.dialect === 'postgres' ? 'FOR NO KEY UPDATE' : '';
    const mappingRow = await tx.get<{
      metadata_json: string;
      target_id: string | null;
      requested_by_workspace_user_id: string | null;
    }>(
      `SELECT metadata_json, requested_by_workspace_user_id,
              COALESCE(claimed_by_execution_target_id, execution_target_id) AS target_id
         FROM execution_requests
        WHERE id = ? AND workspace_id = ? AND project_id = ? AND mission_id = ?
          AND deleted_at IS NULL ${lock}`,
      [mappingId, ctx.workspace.id, projectId, missionId]
    );
    if (!mappingRow || mappingRow.requested_by_workspace_user_id !== ctx.actorWorkspaceUserId)
      return null;
    const metadata = JSON.parse(mappingRow.metadata_json) as Record<string, unknown>;
    const mapping = providerSessionFromMetadata(metadata);
    if (
      !mapping ||
      mapping.providerSessionId !== providerSessionId ||
      mapping.lastObservedState === 'exited' ||
      (mapping.executionTargetId ?? mappingRow.target_id) !== executionTargetId
    )
      return null;

    // Preserve the old mission-anchored job's working-directory resolution.
    const anchor = await tx.get<{ resource_key: string | null }>(
      `SELECT resource_key FROM objectives
        WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
        ORDER BY position LIMIT 1`,
      [missionId, ctx.workspace.id]
    );
    if (!anchor) return null;
    const executable =
      launchSessionSnapshotFromMetadata(metadata)?.executionProvider.executable ?? 'latch';
    const backgroundProbeKey = createHash('sha256')
      .update(
        JSON.stringify([
          ctx.workspace.id,
          projectId,
          missionId,
          mappingId,
          providerSessionId,
          executionTargetId,
          ctx.actorWorkspaceUserId,
          eligibilityMember,
          ctx.actorTokenId ?? null,
          anchor.resource_key,
          executable
        ])
      )
      .digest('hex');
    const now = Date.now();
    const existing = await tx.get<{ id: string; created_at: string }>(
      `SELECT id, created_at FROM execution_requests
        WHERE background_probe_key = ? AND workspace_id = ? AND execution_target_id = ?
          AND deleted_at IS NULL AND created_at >= ?
          AND (status IN ('queued', 'claimed', 'launching') OR (status = 'launched' AND created_at >= ?))
        ORDER BY created_at DESC, id LIMIT 1`,
      [
        backgroundProbeKey,
        ctx.workspace.id,
        executionTargetId,
        new Date(now - TERMINAL_PROBE_TIMEOUT_MS).toISOString(),
        new Date(now - TERMINAL_PROBE_RESULT_REUSE_MS).toISOString()
      ]
    );
    if (existing)
      return {
        id: existing.id,
        startedAt: new Date(existing.created_at).toISOString(),
        reused: true
      };

    const { id, createdAt } = await createLocalTargetMutationRequest({
      ctx: { ...ctx, db: tx },
      projectId,
      executionTargetId,
      kind: 'capability_call',
      capability: 'inspectLatchSession',
      input: { providerSessionId, executable },
      resourceKey: anchor.resource_key,
      backgroundProbeKey
    });
    return { id, startedAt: createdAt, reused: false };
  });
  if (!job) return null;
  const result = await waitForLocalTargetMutationResult({
    ctx,
    requestId: job.id,
    target: { executionTargetId, deviceLabel: null, transport: 'runner_queue' },
    timeoutMs: Date.parse(job.startedAt) + TERMINAL_PROBE_TIMEOUT_MS - Date.now(),
    createListener
  });
  return {
    ...job,
    result: result.ok ? { ...result, value: result.value as InspectLatchSessionResult } : result
  };
}
