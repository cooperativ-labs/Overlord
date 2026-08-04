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

function deliveryIdPredicate(dialect: ServiceContext['db']['dialect']): string {
  return dialect === 'postgres'
    ? "payload_json->>'deliveryId' = ?"
    : "json_extract(payload_json, '$.deliveryId') = ?";
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
  const existing = (await ctx.db.get(
    `SELECT id FROM worker_jobs
       WHERE workspace_id = ?
         AND type = ?
         AND status IN ('queued', 'running')
         AND deleted_at IS NULL
         AND ${deliveryIdPredicate(ctx.db.dialect)}
       ORDER BY created_at ASC
       LIMIT 1`,
    [ctx.workspace.id, DELIVERY_COMPOSE_JOB_TYPE, deliveryId]
  )) as { id: string } | undefined;
  if (existing) {
    return { jobId: existing.id, enqueued: false };
  }

  const jobId = newId();
  await ctx.db.run(
    `INSERT INTO worker_jobs
         (id, workspace_id, type, status, priority, run_after, attempt_count, max_attempts,
          payload_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?, 1)`,
    [
      jobId,
      ctx.workspace.id,
      DELIVERY_COMPOSE_JOB_TYPE,
      priority,
      now,
      maxAttempts,
      JSON.stringify({ deliveryId }),
      now,
      now
    ]
  );
  // Structured operational metric only: delivery content and prompt inputs are
  // intentionally never logged.
  console.info(
    '[delivery-compose-worker]',
    JSON.stringify({ event: 'delivery_compose_queued', deliveryId, jobId, maxAttempts, priority })
  );
  return { jobId, enqueued: true };
}
