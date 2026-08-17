/**
 * Ingest Latch harness events into execution-request presentation state.
 *
 * The agent's protocol attach is the record. This fold is presentation, plus
 * permission/question notifications sourced from Latch `awaiting_input`.
 */

import type { HarnessEvent } from './latch-harness/generated.ts';
import { emitNotification } from './notifications/notifications.ts';
import { recordChange } from './change-feed.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import {
  foldHarnessEvents,
  type LatchHarnessObservation,
  mergeHarnessObservation,
  parseHarnessEvent
} from './latch-events.ts';
import {
  type ExecutionProviderSession,
  mergeProviderSessionIntoMetadata,
  providerSessionFromMetadata,
  stripProviderSessionFromMetadata
} from './latch-launch.ts';
import { nowIso } from './util.ts';

export type IngestLatchHarnessEventsResult = {
  providerSessionId: string;
  observation: LatchHarnessObservation;
  notified: boolean;
};

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function ingestLatchHarnessEvents({
  ctx,
  missionId,
  executionRequestId,
  providerSessionId,
  events,
  from = 0
}: {
  ctx: ServiceContext;
  missionId: string;
  executionRequestId?: string | null;
  providerSessionId: string;
  events: unknown[];
  from?: number;
}): Promise<IngestLatchHarnessEventsResult> {
  const sessionId = providerSessionId.trim();
  if (!sessionId) {
    throw new ServiceError('A Latch session id is required.', 'validation_error');
  }
  const parsedEvents = events
    .map(event => parseHarnessEvent(event))
    .filter((event): event is HarnessEvent => event !== null);
  const fromCursor = Number.isFinite(from) && from > 0 ? Math.floor(from) : 0;

  return ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    const rows = await tx.all<{
      id: string;
      workspace_id: string;
      project_id: string | null;
      mission_id: string;
      objective_id: string;
      launched_session_id: string | null;
      metadata_json: string | null;
      revision: number;
    }>(
      executionRequestId
        ? `SELECT id, workspace_id, project_id, mission_id, objective_id, launched_session_id,
                  metadata_json, revision
             FROM execution_requests
            WHERE id = ? AND mission_id = ? AND workspace_id = ? AND deleted_at IS NULL`
        : `SELECT id, workspace_id, project_id, mission_id, objective_id, launched_session_id,
                  metadata_json, revision
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

    if (!row) {
      throw new ServiceError('Latch session is not mapped to this mission', 'not_found', 404);
    }

    const metadata = parseMetadata(row.metadata_json);
    const providerSession = providerSessionFromMetadata(metadata);
    if (!providerSession || providerSession.providerSessionId !== sessionId) {
      throw new ServiceError('Latch session is not mapped to this mission', 'not_found', 404);
    }

    const attached = Boolean(providerSession.agentSessionId || row.launched_session_id);
    const previous = providerSession.observation ?? null;
    const storedCursor = previous?.cursor ?? 0;
    let observation: LatchHarnessObservation;
    if (fromCursor < storedCursor) {
      observation = {
        ...previous!,
        unattached: (previous?.turnCount ?? 0) > 0 && !attached
      };
    } else if (parsedEvents.length === 0) {
      observation = {
        cursor: storedCursor,
        connectorEpoch: previous?.connectorEpoch ?? null,
        lastEventAt: previous?.lastEventAt ?? null,
        turnCount: previous?.turnCount ?? 0,
        pendingInput: previous?.pendingInput ?? null,
        unattached: (previous?.turnCount ?? 0) > 0 && !attached
      };
    } else {
      observation = mergeHarnessObservation({
        previous,
        incoming: foldHarnessEvents({
          events: parsedEvents,
          fromCursor,
          attached
        }),
        attached
      });
    }

    const nextSession: ExecutionProviderSession = {
      ...providerSession,
      observation
    };
    const now = nowIso();
    const revision = row.revision + 1;
    const metadataJson = mergeProviderSessionIntoMetadata({
      metadataJson: row.metadata_json,
      providerSession: nextSession
    });
    const updated = await tx.run(
      `UPDATE execution_requests
          SET metadata_json = ?, updated_at = ?, revision = ?
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [metadataJson, now, revision, row.id, row.revision]
    );
    if (updated.changes === 0) {
      throw new ServiceError(
        'Execution request changed while ingesting harness events',
        'execution_request_conflict',
        409
      );
    }
    await recordChange({
      ctx: txCtx,
      entityType: 'execution_request',
      entityId: row.id,
      operation: 'update',
      entityRevision: revision,
      projectId: row.project_id,
      missionId: row.mission_id,
      objectiveId: row.objective_id,
      changedFields: ['metadata_json']
    });

    const previousRequestId = previous?.pendingInput?.requestId ?? null;
    const nextRequestId = observation.pendingInput?.requestId ?? null;
    let notified = false;
    if (nextRequestId && nextRequestId !== previousRequestId) {
      const emitted = await emitNotification({
        db: tx,
        workspaceId: row.workspace_id,
        missionId: row.mission_id,
        type: 'agent_question',
        objectiveId: row.objective_id,
        now
      });
      notified = emitted.emitted;
    }

    return {
      providerSessionId: sessionId,
      observation,
      notified
    };
  });
}

export async function bindProviderSessionAgentSession({
  ctx,
  executionRequestId,
  agentSessionId
}: {
  ctx: ServiceContext;
  executionRequestId: string;
  agentSessionId: string;
}): Promise<void> {
  const row = await ctx.db.get<{ metadata_json: string | null; revision: number }>(
    `SELECT metadata_json, revision FROM execution_requests
      WHERE id = ? AND deleted_at IS NULL`,
    [executionRequestId]
  );
  if (!row) return;
  const providerSession = providerSessionFromMetadata(parseMetadata(row.metadata_json));
  if (!providerSession) return;
  if (providerSession.agentSessionId === agentSessionId) return;
  const attachedObservation = providerSession.observation
    ? { ...providerSession.observation, unattached: false }
    : null;
  const metadataJson = mergeProviderSessionIntoMetadata({
    metadataJson: row.metadata_json,
    providerSession: {
      ...providerSession,
      agentSessionId,
      observation: attachedObservation
    }
  });
  await ctx.db.run(
    `UPDATE execution_requests SET metadata_json = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND deleted_at IS NULL`,
    [metadataJson, nowIso(), executionRequestId]
  );
}

export async function clearLatchPendingInput({
  ctx,
  missionId,
  providerSessionId,
  requestId
}: {
  ctx: ServiceContext;
  missionId: string;
  providerSessionId: string;
  requestId: string;
}): Promise<LatchHarnessObservation | null> {
  const rows = await ctx.db.all<{
    id: string;
    metadata_json: string | null;
    launched_session_id: string | null;
    revision: number;
  }>(
    `SELECT id, metadata_json, launched_session_id, revision
       FROM execution_requests
      WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC, created_at DESC`,
    [missionId, ctx.workspace.id]
  );
  const row = rows.find(candidate => {
    const mapped = providerSessionFromMetadata(parseMetadata(candidate.metadata_json));
    return mapped?.providerSessionId === providerSessionId;
  });
  if (!row) return null;
  const providerSession = providerSessionFromMetadata(parseMetadata(row.metadata_json));
  if (!providerSession || providerSession.providerSessionId !== providerSessionId) return null;
  const pending = providerSession.observation?.pendingInput;
  if (!pending || pending.requestId !== requestId) {
    return providerSession.observation ?? null;
  }
  const attached = Boolean(providerSession.agentSessionId || row.launched_session_id);
  const observation: LatchHarnessObservation = {
    ...providerSession.observation!,
    pendingInput: null,
    unattached: (providerSession.observation?.turnCount ?? 0) > 0 && !attached
  };
  await ctx.db.run(
    `UPDATE execution_requests SET metadata_json = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND deleted_at IS NULL`,
    [
      mergeProviderSessionIntoMetadata({
        metadataJson: row.metadata_json,
        providerSession: { ...providerSession, observation }
      }),
      nowIso(),
      row.id
    ]
  );
  return observation;
}

export type ForgetLatchProviderSessionResult = {
  forgotten: boolean;
  executionRequestId: string | null;
};

/**
 * Drop a mission's Latch provider-session mapping after Latch itself has
 * reclaimed the session. Idempotent: a mapping that is already gone is a
 * successful no-op. Does not stop a process and does not delete the
 * execution request.
 */
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
    const txCtx = { ...ctx, db: tx };
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

    if (!row) {
      return { forgotten: false, executionRequestId: executionRequestId ?? null };
    }

    const metadataJson = stripProviderSessionFromMetadata({
      metadataJson: row.metadata_json
    });
    const now = nowIso();
    const revision = row.revision + 1;
    const updated = await tx.run(
      `UPDATE execution_requests
          SET metadata_json = ?, updated_at = ?, revision = ?
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [metadataJson, now, revision, row.id, row.revision]
    );
    if (updated.changes === 0) {
      throw new ServiceError(
        'Execution request changed while forgetting the Latch session',
        'execution_request_conflict',
        409
      );
    }
    await recordChange({
      ctx: txCtx,
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
