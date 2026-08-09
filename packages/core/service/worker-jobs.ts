import type { DatabaseClient } from '@overlord/database';

import type { ServiceContext } from './context.js';
import { newId, nowIso } from './util.js';

/** Core-documented worker job type for asynchronous delivery presentation composition. */
export const DELIVERY_COMPOSE_JOB_TYPE = 'overlord.delivery.compose.v1';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_PRIORITY = 50;
const DEFAULT_LOCK_TTL_MS = 60_000;

/** Shared retry schedule for durable worker_jobs consumers. */
export const WORKER_JOB_RETRY_BACKOFF_MS = [15_000, 60_000, 300_000, 900_000, 3_600_000] as const;

/** The common row shape claimed by all in-process worker_jobs consumers. */
export type ClaimedWorkerJob = {
  id: string;
  payload_json: string;
  attempt_count: number;
  max_attempts: number;
  revision: number;
};

/**
 * One JSON field used to coalesce otherwise identical active worker jobs.
 * The field name is intentionally constrained before it is incorporated into
 * the dialect-specific SQL expression; values remain bound parameters.
 */
export type WorkerJobDedupeBy = {
  field: string;
  value: string;
};

export function workerJobJsonFieldPredicate(
  dialect: DatabaseClient['dialect'],
  field: string
): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)) {
    throw new Error(`Invalid worker job JSON field: ${field}`);
  }
  return dialect === 'postgres'
    ? `payload_json->>'${field}' = ?`
    : `json_extract(payload_json, '$.${field}') = ?`;
}

export function workerJobRetryDelay(attemptCount: number): number {
  return WORKER_JOB_RETRY_BACKOFF_MS[
    Math.min(Math.max(attemptCount - 1, 0), WORKER_JOB_RETRY_BACKOFF_MS.length - 1)
  ]!;
}

/**
 * Reclaims stale leases and claims one queued job with a revision CAS. The
 * transaction and Postgres SKIP LOCKED clause keep concurrent worker polls
 * from processing the same job.
 */
export async function claimNextWorkerJob({
  db,
  jobType,
  workerId,
  now = nowIso(),
  lockTtlMs = DEFAULT_LOCK_TTL_MS
}: {
  db: DatabaseClient;
  jobType: string;
  workerId: string;
  now?: string;
  lockTtlMs?: number;
}): Promise<ClaimedWorkerJob | null> {
  return db.transaction(async tx => {
    await tx.run(
      `UPDATE worker_jobs SET status = 'queued', locked_by = NULL, locked_until = NULL, updated_at = ?, revision = revision + 1
       WHERE type = ? AND status = 'running' AND deleted_at IS NULL AND locked_until < ?`,
      [now, jobType, now]
    );
    const lockClause = tx.dialect === 'postgres' ? 'FOR UPDATE SKIP LOCKED' : '';
    const candidate = await tx.get<ClaimedWorkerJob>(
      `SELECT id, payload_json, attempt_count, max_attempts, revision FROM worker_jobs
        WHERE type = ? AND status = 'queued' AND deleted_at IS NULL AND run_after <= ?
        ORDER BY priority ASC, run_after ASC LIMIT 1 ${lockClause}`,
      [jobType, now]
    );
    if (!candidate) return null;

    const updated = await tx.run(
      `UPDATE worker_jobs SET status = 'running', attempt_count = attempt_count + 1, locked_by = ?, locked_until = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND status = 'queued' AND revision = ?`,
      [
        workerId,
        new Date(Date.parse(now) + lockTtlMs).toISOString(),
        now,
        candidate.id,
        candidate.revision
      ]
    );
    return updated.changes === 0
      ? null
      : {
          ...candidate,
          attempt_count: candidate.attempt_count + 1,
          revision: candidate.revision + 1
        };
  });
}

export async function finishWorkerJob(
  db: DatabaseClient,
  id: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  lastError: string | null,
  now = nowIso()
): Promise<void> {
  await db.run(
    `UPDATE worker_jobs SET status = ?, last_error = ?, locked_by = NULL, locked_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?`,
    [status, lastError, now, id]
  );
}

export async function retryWorkerJob(
  db: DatabaseClient,
  id: string,
  attemptCount: number,
  lastError: string,
  now = nowIso()
): Promise<void> {
  await db.run(
    `UPDATE worker_jobs SET status = 'queued', run_after = ?, last_error = ?, locked_by = NULL,
       locked_until = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?`,
    [
      new Date(Date.parse(now) + workerJobRetryDelay(attemptCount)).toISOString(),
      lastError,
      now,
      id
    ]
  );
}

/**
 * Enqueue a durable worker job if no identical job is already queued or
 * running. Jobs carry only caller-provided payloads; each worker owns how that
 * payload is interpreted and delivered.
 */
export async function enqueueWorkerJob({
  db,
  workspaceId,
  type,
  dedupeBy,
  payload,
  priority = DEFAULT_PRIORITY,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  now = nowIso()
}: {
  db: DatabaseClient;
  workspaceId: string;
  type: string;
  dedupeBy: WorkerJobDedupeBy;
  payload: unknown;
  priority?: number;
  maxAttempts?: number;
  now?: string;
}): Promise<{ jobId: string | null; enqueued: boolean }> {
  const existing = await db.get<{ id: string }>(
    `SELECT id FROM worker_jobs
       WHERE workspace_id = ?
         AND type = ?
         AND status IN ('queued', 'running')
         AND deleted_at IS NULL
         AND ${workerJobJsonFieldPredicate(db.dialect, dedupeBy.field)}
       ORDER BY created_at ASC
       LIMIT 1`,
    [workspaceId, type, dedupeBy.value]
  );
  if (existing) return { jobId: existing.id, enqueued: false };

  const jobId = newId();
  await db.run(
    `INSERT INTO worker_jobs
         (id, workspace_id, type, status, priority, run_after, attempt_count, max_attempts,
          payload_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?, 1)`,
    [jobId, workspaceId, type, priority, now, maxAttempts, JSON.stringify(payload), now, now]
  );
  return { jobId, enqueued: true };
}

/**
 * Enqueues a durable compose job for one delivery. Safe to call inside the
 * delivery transaction; duplicate active jobs for the same delivery are skipped.
 */
export async function enqueueDeliveryComposeJob({
  ctx,
  deliveryId,
  now = nowIso(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  priority = DEFAULT_PRIORITY
}: {
  ctx: ServiceContext;
  deliveryId: string;
  now?: string;
  maxAttempts?: number;
  priority?: number;
}): Promise<{ jobId: string | null; enqueued: boolean }> {
  const result = await enqueueWorkerJob({
    db: ctx.db,
    workspaceId: ctx.workspace.id,
    type: DELIVERY_COMPOSE_JOB_TYPE,
    dedupeBy: { field: 'deliveryId', value: deliveryId },
    payload: { deliveryId },
    priority,
    maxAttempts,
    now
  });
  // Structured operational metric only: delivery content and prompt inputs are
  // intentionally never logged.
  if (result.enqueued) {
    console.info(
      '[delivery-compose-worker]',
      JSON.stringify({
        event: 'delivery_compose_queued',
        deliveryId,
        jobId: result.jobId,
        maxAttempts,
        priority
      })
    );
  }
  return result;
}

/**
 * Resolves the active workspace profile assigned to a mission. Assignment is
 * the shared addressing rule for standard push and both Live Activity paths.
 */
export async function missionOwnerProfileId({
  db,
  workspaceId,
  missionId
}: {
  db: DatabaseClient;
  workspaceId: string;
  missionId: string;
}): Promise<string | null> {
  const owner = await db.get<{ profile_id: string }>(
    `SELECT wu.profile_id
       FROM missions m
       JOIN workspace_users wu ON wu.id = m.assigned_workspace_user_id
      WHERE m.id = ? AND m.workspace_id = ? AND m.deleted_at IS NULL
        AND wu.deleted_at IS NULL AND wu.status = 'active'`,
    [missionId, workspaceId]
  );
  return owner?.profile_id ?? null;
}
