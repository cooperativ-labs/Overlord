/** Persistence helpers for Latch terminal provider-session mappings. */

import { recordChange } from './change-feed.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import {
  mergeProviderSessionIntoMetadata,
  providerSessionFromMetadata,
  stripProviderSessionFromMetadata
} from './latch-launch.ts';
import { nowIso } from './util.ts';

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Correlate a terminal provider mapping with the attached agent session. */
export async function bindProviderSessionAgentSession({
  ctx,
  executionRequestId,
  agentSessionId
}: {
  ctx: ServiceContext;
  executionRequestId: string;
  agentSessionId: string;
}): Promise<void> {
  const row = await ctx.db.get<{ metadata_json: string | null }>(
    `SELECT metadata_json FROM execution_requests WHERE id = ? AND deleted_at IS NULL`,
    [executionRequestId]
  );
  if (!row) return;
  const providerSession = providerSessionFromMetadata(parseMetadata(row.metadata_json));
  if (!providerSession || providerSession.agentSessionId === agentSessionId) return;
  await ctx.db.run(
    `UPDATE execution_requests SET metadata_json = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND deleted_at IS NULL`,
    [
      mergeProviderSessionIntoMetadata({
        metadataJson: row.metadata_json,
        providerSession: { ...providerSession, agentSessionId }
      }),
      nowIso(),
      executionRequestId
    ]
  );
}

export type ForgetLatchProviderSessionResult = {
  forgotten: boolean;
  executionRequestId: string | null;
};

export type ResolvedLatchSession = {
  targetId: string;
  providerSessionId: string;
  lastObservedState: string;
};

/**
 * Find the Latch provider session recorded for an attached agent session.
 * The mapping lives on the launch request so it remains a correlation record,
 * never a session credential or a new cross-component persistence surface.
 */
export async function resolveLatchSessionForAgentSession({
  ctx,
  sessionId
}: {
  ctx: ServiceContext;
  sessionId: string;
}): Promise<ResolvedLatchSession | null> {
  const rows = await ctx.db.all<{
    metadata_json: string | null;
    claimed_by_execution_target_id: string | null;
    execution_target_id: string | null;
  }>(
    `SELECT metadata_json, claimed_by_execution_target_id, execution_target_id
       FROM execution_requests
      WHERE workspace_id = ? AND launched_session_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC, created_at DESC`,
    [ctx.workspace.id, sessionId]
  );
  for (const row of rows) {
    const providerSession = providerSessionFromMetadata(parseMetadata(row.metadata_json));
    const targetId =
      providerSession?.executionTargetId ??
      row.claimed_by_execution_target_id ??
      row.execution_target_id;
    if (!providerSession || !targetId) continue;
    return {
      targetId,
      providerSessionId: providerSession.providerSessionId,
      lastObservedState: providerSession.lastObservedState
    };
  }
  return null;
}

/** Drop a provider mapping after Latch reports the session absent. */
export async function forgetLatchProviderSession({
  ctx,
  missionId,
  executionRequestId,
  providerSessionId
}: {
  ctx: ServiceContext;
  missionId: string;
  executionRequestId?: string | null;
  providerSessionId: string;
}): Promise<ForgetLatchProviderSessionResult> {
  const sessionId = providerSessionId.trim();
  if (!sessionId) {
    throw new ServiceError('A Latch session id is required.', 'validation_error');
  }

  return ctx.db.transaction(async tx => {
    const rows = await tx.all<{
      id: string;
      project_id: string | null;
      mission_id: string;
      objective_id: string;
      metadata_json: string | null;
      revision: number;
    }>(
      executionRequestId
        ? `SELECT id, project_id, mission_id, objective_id, metadata_json, revision
             FROM execution_requests
            WHERE id = ? AND mission_id = ? AND workspace_id = ? AND deleted_at IS NULL`
        : `SELECT id, project_id, mission_id, objective_id, metadata_json, revision
             FROM execution_requests
            WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
            ORDER BY updated_at DESC, created_at DESC`,
      executionRequestId
        ? [executionRequestId, missionId, ctx.workspace.id]
        : [missionId, ctx.workspace.id]
    );
    const row = rows.find(candidate => {
      const mapped = providerSessionFromMetadata(parseMetadata(candidate.metadata_json));
      return mapped?.providerSessionId === sessionId;
    });
    if (!row) return { forgotten: false, executionRequestId: executionRequestId ?? null };

    const metadataJson = stripProviderSessionFromMetadata({ metadataJson: row.metadata_json });
    const revision = row.revision + 1;
    const updated = await tx.run(
      `UPDATE execution_requests SET metadata_json = ?, updated_at = ?, revision = ?
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [metadataJson, nowIso(), revision, row.id, row.revision]
    );
    if (updated.changes === 0) {
      throw new ServiceError(
        'Execution request changed while forgetting the Latch session',
        'execution_request_conflict',
        409
      );
    }
    await recordChange({
      ctx: { ...ctx, db: tx },
      entityType: 'execution_request',
      entityId: row.id,
      operation: 'update',
      entityRevision: revision,
      projectId: row.project_id,
      missionId: row.mission_id,
      objectiveId: row.objective_id,
      changedFields: ['metadata_json']
    });
    return { forgotten: true, executionRequestId: row.id };
  });
}
