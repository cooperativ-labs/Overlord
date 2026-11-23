// The runner-queue transport for local-target capabilities.
//
// A capability call that must run on a device the backend is not is written as
// an `execution_requests` row with `requested_source = 'local_target_mutation'`
// and `metadata_json.overlord.localTargetMutation = { kind, capability, input }`.
// `ovld runner` claims it off the ordinary claim loop, executes it against an
// in-process provider, and posts the `CapabilityResult` envelope back to
// `POST /api/runner/requests/:id/completed`, which stores it on the same row.
// `waitForLocalTargetMutationResult` is the caller's half: it blocks on the
// stored result so `RunnerQueueProvider` can present the whole round trip as an
// ordinary `LocalTargetCapabilities` call.

import { recordAnswerDeliveryResult } from './agent-session/answer-delivery.ts';
import { fail } from './local-target/result.ts';
import type {
  CapabilityFailure,
  CapabilityResult,
  CapabilitySuccess,
  TargetMetadata
} from './local-target/types.ts';
import {
  isQueueableCapabilityName,
  type QueueableCapabilityName,
  type SendLatchMessageResult,
  toLocalTargetErrorCode
} from './local-target/types.ts';
import { recordChange } from './change-feed.ts';
import type { ServiceContext } from './context.ts';
import { resolveMissionId, resolveProjectId } from './context.ts';
import { ServiceError } from './errors.ts';
import { forgetAbsentLatchProviderSessions } from './latch-provider-session.ts';
import { parseMetadataJson } from './records.ts';
import { newId, nowIso } from './util.ts';

export const LOCAL_TARGET_MUTATION_METADATA_KEY = 'overlord.localTargetMutation';
export const LOCAL_TARGET_MUTATION_REQUESTED_SOURCE = 'local_target_mutation';

/**
 * `branch_action` and `worktree_purge` are retained because they drive their own
 * mission activity-feed events on completion. Everything else queued through
 * this path is a plain `capability_call`.
 */
export type LocalTargetMutationKind = 'branch_action' | 'worktree_purge' | 'capability_call';

/** Any capability the runner will execute off-device (`launchAgent` excluded). */
export type LocalTargetMutationCapability = QueueableCapabilityName;

export type LocalTargetMutationStoredResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string; details?: unknown };

export type LocalTargetMutationPayload = {
  kind: LocalTargetMutationKind;
  capability: LocalTargetMutationCapability;
  input: Record<string, unknown>;
  /**
   * The project resource a mission-less call addresses. The claim resolves
   * this resource on the target instead of falling back to the primary one.
   */
  resourceKey?: string;
  result?: LocalTargetMutationStoredResult;
};

export type LocalTargetMutationResult = CapabilitySuccess<unknown> | CapabilityFailure;

/** Default deadline for a queued read capability — long enough for a claim poll. */
export const LOCAL_TARGET_MUTATION_READ_TIMEOUT_MS = 30_000;
/** Default deadline for a queued mutation, which may do real Git work. */
export const LOCAL_TARGET_MUTATION_WRITE_TIMEOUT_MS = 120_000;

const DEFAULT_RESULT_POLL_INTERVAL_MS = 250;

/** Execution-request statuses that can never produce a result any more. */
const TERMINAL_WITHOUT_RESULT = ['failed', 'cleared', 'cancelled', 'expired'] as const;

export function buildLocalTargetMutationMetadata({
  kind,
  capability,
  input,
  resourceKey = null
}: {
  kind: LocalTargetMutationKind;
  capability: LocalTargetMutationCapability;
  input: Record<string, unknown>;
  resourceKey?: string | null;
}): Record<string, unknown> {
  const key = resourceKey?.trim();
  return {
    [LOCAL_TARGET_MUTATION_METADATA_KEY]: {
      kind,
      capability,
      input,
      ...(key ? { resourceKey: key } : {})
    } satisfies LocalTargetMutationPayload
  };
}

export function parseLocalTargetMutation(
  metadataJson: string | Record<string, unknown>
): LocalTargetMutationPayload | null {
  const metadata =
    typeof metadataJson === 'string' ? parseMetadataJson(metadataJson) : metadataJson;
  const raw = metadata[LOCAL_TARGET_MUTATION_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  const kind = payload.kind;
  const capability = payload.capability;
  if (kind !== 'branch_action' && kind !== 'worktree_purge' && kind !== 'capability_call') {
    return null;
  }
  // Fail closed on an unknown or excluded capability name: a queued job whose
  // capability we cannot name is never handed to a provider.
  if (!isQueueableCapabilityName(capability)) return null;
  const input =
    payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
      ? (payload.input as Record<string, unknown>)
      : {};
  const resourceKey =
    typeof payload.resourceKey === 'string' && payload.resourceKey.trim()
      ? payload.resourceKey.trim()
      : undefined;
  const result = payload.result;
  const parsedResult =
    result && typeof result === 'object' && !Array.isArray(result)
      ? (result as LocalTargetMutationPayload['result'])
      : undefined;
  return {
    kind,
    capability,
    input,
    ...(resourceKey ? { resourceKey } : {}),
    ...(parsedResult ? { result: parsedResult } : {})
  };
}

/** Rehydrate a stored envelope into a live {@link CapabilityResult}. */
export function storedResultToCapabilityResult(
  target: TargetMetadata,
  stored: LocalTargetMutationStoredResult
): LocalTargetMutationResult {
  if (stored.ok) return { ok: true, value: stored.value, target };
  return fail(
    target,
    toLocalTargetErrorCode(stored.code),
    stored.message,
    stored.details === undefined ? undefined : stored.details
  );
}

async function resolveMutationObjectiveId({
  ctx,
  missionId
}: {
  ctx: ServiceContext;
  missionId: string;
}): Promise<string> {
  const row = (await ctx.db.get(
    `SELECT id FROM objectives
        WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
        ORDER BY position ASC
        LIMIT 1`,
    [missionId, ctx.workspace.id]
  )) as { id: string } | undefined;
  if (!row) {
    throw new ServiceError(
      'Mission has no objectives to anchor a local-target mutation request.',
      'no_objective_for_mutation',
      409
    );
  }
  return row.id;
}

export async function createLocalTargetMutationRequest({
  ctx,
  projectId,
  missionId = null,
  executionTargetId,
  kind,
  capability,
  input,
  operationId = null,
  resourceKey = null,
  backgroundProbeKey = null,
  eventSummary
}: {
  ctx: ServiceContext;
  projectId: string;
  /**
   * The mission this call belongs to, when it has one. Capability calls with no
   * mission (a Latch probe, a repository read, `doctor`) queue with a null
   * mission/objective and are authorized by project + execution target instead.
   */
  missionId?: string | null;
  executionTargetId: string;
  kind: LocalTargetMutationKind;
  capability: LocalTargetMutationCapability;
  input: Record<string, unknown>;
  /**
   * Caller-supplied idempotency key. Reusing it makes a retry resolve to the
   * already-queued job rather than queueing a second one.
   */
  operationId?: string | null;
  /** Project resource to resolve at claim (mission-less calls); null means primary. */
  resourceKey?: string | null;
  /** Internal marker supplied only by the scoped terminal observer. */
  backgroundProbeKey?: string | null;
  eventSummary?: string;
}): Promise<{ id: string; reused: boolean; createdAt: string }> {
  const mission = missionId === null ? null : await resolveMissionId(ctx, missionId);
  const resolvedProjectId = await resolveProjectId(ctx, projectId);
  const objectiveId =
    mission === null ? null : await resolveMutationObjectiveId({ ctx, missionId: mission.id });
  const idempotencyKey = operationId?.trim() || null;
  if (idempotencyKey !== null) {
    const existing = (await ctx.db.get(
      `SELECT id, created_at FROM execution_requests
        WHERE workspace_id = ? AND idempotency_key = ? AND deleted_at IS NULL`,
      [ctx.workspace.id, idempotencyKey]
    )) as { id: string; created_at: string } | undefined;
    if (existing) return { id: existing.id, reused: true, createdAt: existing.created_at };
  }
  const now = nowIso();
  const id = newId();
  const metadata = buildLocalTargetMutationMetadata({ kind, capability, input, resourceKey });

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    await txCtx.db.run(
      `INSERT INTO execution_requests
           (id, workspace_id, project_id, mission_id, objective_id, execution_target_id,
            requested_agent, requested_model, requested_reasoning_effort, launch_mode,
            launch_flags_json, requested_source, idempotency_key, status,
            requested_by_workspace_user_id, resolved_resource_id, resolved_working_directory,
            metadata_json, created_at, updated_at, revision, background_probe_key)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'run', '{}', ?, ?, 'queued', ?, NULL, NULL, ?, ?, ?, 1, ?)`,
      [
        id,
        ctx.workspace.id,
        resolvedProjectId,
        mission?.id ?? null,
        objectiveId,
        executionTargetId,
        LOCAL_TARGET_MUTATION_REQUESTED_SOURCE,
        idempotencyKey,
        ctx.actorWorkspaceUserId,
        JSON.stringify(metadata),
        now,
        now,
        backgroundProbeKey
      ]
    );
    if (backgroundProbeKey === null)
      await recordChange({
        ctx: txCtx,
        entityType: 'execution_request',
        entityId: id,
        operation: 'insert',
        entityRevision: 1,
        projectId: resolvedProjectId,
        missionId: mission?.id ?? null,
        objectiveId,
        changedFields: ['status', 'requested_source', 'metadata_json']
      });
    // A mission event needs a mission. A capability call queued without one
    // (settings probe, repository read) is recorded by `entity_changes` only.
    if (mission !== null && objectiveId !== null) {
      await txCtx.db.run(
        `INSERT INTO mission_events
             (id, workspace_id, project_id, mission_id, objective_id, type, phase, summary,
              payload_json, source, actor_workspace_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'execution_requested', 'execute', ?, ?, 'webapp', ?, ?)`,
        [
          newId(),
          ctx.workspace.id,
          resolvedProjectId,
          mission.id,
          objectiveId,
          eventSummary ?? `Delegated ${kind.replace('_', ' ')} on remote execution target.`,
          JSON.stringify({ executionRequestId: id, kind, capability }),
          ctx.actorWorkspaceUserId,
          now
        ]
      );
    }
  });

  return { id, reused: false, createdAt: now };
}

/**
 * A wake primitive for a queued job's completion. Postgres arms `LISTEN` on the
 * completion channel; SQLite has none and the waiter falls back to a bounded
 * poll. Injected by the caller so `@overlord/core` never depends on `pg`.
 */
export interface LocalTargetMutationCompletionListener {
  /** Resolve on a completion notification, or after the listener's own bound. */
  wait(): Promise<void>;
  close(): Promise<void>;
}

export type LocalTargetMutationCompletionListenerFactory = (args: {
  requestId: string;
  timeoutMs: number;
}) => Promise<LocalTargetMutationCompletionListener | null>;

function sleep(ms: number, signal: AbortSignal | null = null): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Read the stored `CapabilityResult` for a queued job, or `null` while it is
 * still outstanding. A request that reached a terminal status without ever
 * storing a result (cleared, expired, failed before the runner reported)
 * resolves to a typed failure rather than hanging until the deadline.
 */
export async function readLocalTargetMutationResult({
  ctx,
  requestId,
  target
}: {
  ctx: ServiceContext;
  requestId: string;
  target: TargetMetadata;
}): Promise<LocalTargetMutationResult | null> {
  const row = (await ctx.db.get(
    `SELECT status, metadata_json, last_error
       FROM execution_requests
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [requestId, ctx.workspace.id]
  )) as { status: string; metadata_json: string; last_error: string | null } | undefined;
  if (!row) {
    return fail(target, 'TARGET_OPERATION_FAILED', 'The queued capability call no longer exists.', {
      executionRequestId: requestId
    });
  }
  const stored = parseLocalTargetMutation(row.metadata_json)?.result;
  if (stored) return storedResultToCapabilityResult(target, stored);
  if ((TERMINAL_WITHOUT_RESULT as readonly string[]).includes(row.status)) {
    return fail(
      target,
      'TARGET_OPERATION_FAILED',
      row.last_error ?? `The queued capability call ended as ${row.status} without a result.`,
      { executionRequestId: requestId, status: row.status }
    );
  }
  return null;
}

/**
 * Block until the runner stores this job's result, or the deadline passes.
 *
 * A timeout is **not** a failed operation — the job is still live on the target,
 * so `LOCAL_TARGET_TIMEOUT` carries the request id and callers surface "still
 * running" rather than re-queueing the same work.
 */
export async function waitForLocalTargetMutationResult({
  ctx,
  requestId,
  target,
  timeoutMs = LOCAL_TARGET_MUTATION_READ_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_RESULT_POLL_INTERVAL_MS,
  createListener,
  signal = null
}: {
  ctx: ServiceContext;
  requestId: string;
  target: TargetMetadata;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createListener?: LocalTargetMutationCompletionListenerFactory | null;
  /**
   * Stop *waiting* when the caller is cancelled. The queued job is unaffected;
   * the answer is the same `LOCAL_TARGET_TIMEOUT` ("still running there").
   */
  signal?: AbortSignal | null;
}): Promise<LocalTargetMutationResult> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const result = await readLocalTargetMutationResult({ ctx, requestId, target });
    if (result) return result;
    const remaining = deadline - Date.now();
    if (signal?.aborted) {
      return fail(
        target,
        'LOCAL_TARGET_TIMEOUT',
        'The caller stopped waiting. The operation may still be running on the target.',
        { executionRequestId: requestId, cancelled: true }
      );
    }
    if (remaining <= 0) {
      return fail(
        target,
        'LOCAL_TARGET_TIMEOUT',
        'The execution target has not reported a result yet. The operation is still running there.',
        { executionRequestId: requestId, timeoutMs }
      );
    }
    const waitMs = Math.min(remaining, pollIntervalMs);
    const listener = createListener
      ? await createListener({ requestId, timeoutMs: remaining })
      : null;
    if (listener) {
      try {
        await (signal
          ? Promise.race([listener.wait(), sleep(remaining, signal)])
          : listener.wait());
      } finally {
        await listener.close();
      }
    } else {
      await sleep(waitMs, signal);
    }
  }
}

export async function completeLocalTargetMutationRequest({
  ctx,
  requestId,
  result
}: {
  ctx: ServiceContext;
  requestId: string;
  result: LocalTargetMutationResult;
}): Promise<LocalTargetMutationPayload | null> {
  const row = (await ctx.db.get(
    `SELECT id, workspace_id, project_id, mission_id, objective_id, status, revision, metadata_json,
            background_probe_key,
            requested_source, COALESCE(claimed_by_execution_target_id, execution_target_id) AS target_id
       FROM execution_requests
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [requestId, ctx.workspace.id]
  )) as
    | {
        id: string;
        workspace_id: string;
        project_id: string;
        mission_id: string | null;
        objective_id: string | null;
        status: string;
        revision: number;
        metadata_json: string;
        background_probe_key: string | null;
        requested_source: string;
        target_id: string | null;
      }
    | undefined;

  if (!row) {
    throw new ServiceError('Execution request not found', 'execution_request_not_found', 404);
  }
  if (row.requested_source !== LOCAL_TARGET_MUTATION_REQUESTED_SOURCE) {
    throw new ServiceError(
      'Execution request is not a local-target mutation.',
      'not_local_target_mutation',
      409
    );
  }
  const mutation = parseLocalTargetMutation(row.metadata_json);
  // A runner retry after a lost completion response keeps the first result.
  if (row.background_probe_key && mutation?.result) return mutation;
  if (row.status !== 'launching' && row.status !== 'claimed') {
    throw new ServiceError(
      `Cannot complete local-target mutation from status ${row.status}.`,
      'invalid_execution_request_transition',
      409
    );
  }

  if (!mutation) {
    throw new ServiceError(
      'Execution request is missing local-target mutation metadata.',
      'invalid_local_target_mutation',
      409
    );
  }

  const storedResult: LocalTargetMutationStoredResult = result.ok
    ? { ok: true as const, value: result.value }
    : {
        ok: false as const,
        code: result.code,
        message: result.message,
        ...(result.details !== undefined ? { details: result.details } : {})
      };

  const metadata = parseMetadataJson(row.metadata_json);
  metadata[LOCAL_TARGET_MUTATION_METADATA_KEY] = {
    ...mutation,
    result: storedResult
  };

  const now = nowIso();
  const revision = row.revision + 1;
  const nextStatus = result.ok ? 'launched' : 'failed';
  const lastError = result.ok ? null : result.message;

  return ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    const updated = await txCtx.db.run(
      `UPDATE execution_requests
          SET status = ?,
              metadata_json = ?,
              last_error = ?,
              launch_completed_at = ?,
              updated_at = ?,
              revision = ?
        WHERE id = ? AND status = ? AND revision = ?`,
      [
        nextStatus,
        JSON.stringify(metadata),
        lastError,
        now,
        now,
        revision,
        row.id,
        row.status,
        row.revision
      ]
    );
    if (updated.changes === 0) {
      if (row.background_probe_key) {
        const current = await tx.get<{ metadata_json: string }>(
          'SELECT metadata_json FROM execution_requests WHERE id = ? AND workspace_id = ?',
          [row.id, ctx.workspace.id]
        );
        const completed = current && parseLocalTargetMutation(current.metadata_json);
        if (completed?.result) return completed;
      }
      throw new ServiceError(
        'Execution request changed while completing local-target mutation.',
        'execution_request_conflict',
        409
      );
    }
    if (row.background_probe_key === null)
      await recordChange({
        ctx: txCtx,
        entityType: 'execution_request',
        entityId: row.id,
        operation: 'update',
        entityRevision: revision,
        projectId: row.project_id,
        missionId: row.mission_id,
        objectiveId: row.objective_id,
        changedFields: ['status', 'metadata_json', 'last_error', 'launch_completed_at']
      });
    if (row.mission_id !== null && row.objective_id !== null) {
      await txCtx.db.run(
        `INSERT INTO mission_events
             (id, workspace_id, project_id, mission_id, objective_id, type, phase, summary,
              payload_json, source, actor_workspace_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'update', 'execute', ?, ?, 'runner', NULL, ?)`,
        [
          newId(),
          ctx.workspace.id,
          row.project_id,
          row.mission_id,
          row.objective_id,
          result.ok
            ? `Completed ${mutation.kind.replace('_', ' ')} on execution target.`
            : `Local-target mutation failed: ${result.message}`,
          JSON.stringify({ executionRequestId: row.id, result: storedResult }),
          now
        ]
      );
    }
    if (
      row.background_probe_key === null &&
      mutation.capability === 'inspectLatchSession' &&
      !result.ok &&
      result.code === 'LATCH_SESSION_ABSENT' &&
      row.target_id &&
      typeof mutation.input.providerSessionId === 'string'
    ) {
      await forgetAbsentLatchProviderSessions({
        ctx: txCtx,
        projectId: row.project_id,
        executionTargetId: row.target_id,
        providerSessionId: mutation.input.providerSessionId
      });
    }
    await recordAnswerDeliveryOutcome({ ctx: txCtx, mutation, result });
    return { ...mutation, result: storedResult };
  });
}

/**
 * Completion post-hook for answer delivery (coo:833, ADR 0065).
 *
 * A `sendLatchMessage` job is queued with `operationId` naming the request and
 * the delivery attempt — one value that is Latch's idempotency key, the queue's,
 * and the row whose delivery record says what became of the answer. `accepted` →
 * `applied`, `refused` → `not_applied`, `ambiguous` → `unknown`; a failed job is
 * `not_applied` when nothing was sent and `unknown` when a runner held it and
 * went quiet. A report for a superseded attempt changes nothing.
 */
async function recordAnswerDeliveryOutcome({
  ctx,
  mutation,
  result
}: {
  ctx: ServiceContext;
  mutation: LocalTargetMutationPayload;
  result: LocalTargetMutationResult;
}): Promise<void> {
  if (mutation.capability !== 'sendLatchMessage') return;
  const operationId =
    typeof mutation.input.operationId === 'string' ? mutation.input.operationId.trim() : '';
  if (!operationId) return;
  await recordAnswerDeliveryResult({
    ctx,
    operationId,
    result: result as CapabilityResult<SendLatchMessageResult>
  });
}

/**
 * Close the delivery record of answer jobs that reached a terminal status with
 * no result (the expiry sweep, a cleared queue). Without this the answer stays
 * `emitted` forever and the person is told it is still being sent.
 */
export async function recordAnswerDeliveryForTerminalRequest({
  ctx,
  metadataJson,
  status,
  executionRequestId
}: {
  ctx: ServiceContext;
  metadataJson: string | null;
  status: string;
  executionRequestId: string;
}): Promise<void> {
  const mutation = metadataJson ? parseLocalTargetMutation(metadataJson) : null;
  if (!mutation || mutation.result) return;
  await recordAnswerDeliveryOutcome({
    ctx,
    mutation,
    result: fail(
      { executionTargetId: null, deviceLabel: null, transport: 'runner_queue' },
      'TARGET_OPERATION_FAILED',
      `The queued capability call ended as ${status} without a result.`,
      { executionRequestId, status }
    )
  });
}

/**
 * Withdraw an answer job no runner has taken yet.
 *
 * A job left `queued` after the caller stopped waiting would otherwise be
 * delivered whenever the runner next comes online — minutes or hours after the
 * person was told the answer did not go. The compare-and-set on `queued` is the
 * guarantee: either this withdraws it and nothing is ever sent, or a runner
 * already holds it and its own report decides the outcome.
 */
export async function cancelQueuedLocalTargetMutation({
  ctx,
  requestId
}: {
  ctx: ServiceContext;
  requestId: string;
}): Promise<{ cancelled: boolean }> {
  const now = nowIso();
  return await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    const row = (await tx.get(
      `SELECT id, project_id, mission_id, objective_id, revision, metadata_json, background_probe_key
         FROM execution_requests
        WHERE id = ? AND workspace_id = ? AND requested_source = ?
          AND status = 'queued' AND deleted_at IS NULL`,
      [requestId, ctx.workspace.id, LOCAL_TARGET_MUTATION_REQUESTED_SOURCE]
    )) as
      | {
          id: string;
          project_id: string;
          mission_id: string | null;
          objective_id: string | null;
          revision: number;
          metadata_json: string;
          background_probe_key: string | null;
        }
      | undefined;
    if (!row) return { cancelled: false };
    const updated = await tx.run(
      `UPDATE execution_requests
          SET status = 'cancelled', last_error = ?, updated_at = ?, revision = ?
        WHERE id = ? AND status = 'queued' AND revision = ?`,
      ['Withdrawn before any runner claimed it.', now, row.revision + 1, row.id, row.revision]
    );
    if (updated.changes === 0) return { cancelled: false };
    if (row.background_probe_key === null)
      await recordChange({
        ctx: txCtx,
        entityType: 'execution_request',
        entityId: row.id,
        operation: 'update',
        entityRevision: row.revision + 1,
        projectId: row.project_id,
        missionId: row.mission_id,
        objectiveId: row.objective_id,
        changedFields: ['status', 'last_error']
      });
    await recordAnswerDeliveryForTerminalRequest({
      ctx: txCtx,
      metadataJson: row.metadata_json,
      status: 'cancelled',
      executionRequestId: row.id
    });
    return { cancelled: true };
  });
}
