import type { DatabaseClient } from '@overlord/database';

import { insertEntityChange } from './change-feed.js';
import type { ServiceContext } from './context.js';
import { jsonTextFieldSql, newId, nowIso } from './util.js';

/** Core-documented worker job type for asynchronous delivery presentation composition. */
export const DELIVERY_COMPOSE_JOB_TYPE = 'overlord.delivery.compose.v1';

/**
 * Retired worker job type of the automatic mission summary composer (coo:1202).
 * ADR 0076 removed every producer and consumer; migration
 * `20261118140000_agent_only_mission_narrative` cancelled remaining jobs and a
 * database fence drops any new one. Kept only so tests and audits can name it.
 */
export const RETIRED_MISSION_SUMMARY_COMPOSE_JOB_TYPE = 'overlord.mission.summary.compose.v1';

/**
 * Core-documented worker job type for objective briefs: the generated title
 * and summary of one objective (coo:1275, ADR 0058). Payload `{ objectiveId }`.
 */
export const OBJECTIVE_BRIEF_COMPOSE_JOB_TYPE = 'overlord.objective.brief.compose.v1';

/**
 * Debounce for automatic brief requests: repeated instruction saves within
 * this window coalesce into one provider call.
 */
export const OBJECTIVE_BRIEF_DEBOUNCE_MS = 5_000;
/** A debounced brief job is never pushed later than this after it was queued. */
export const OBJECTIVE_BRIEF_MAX_DEBOUNCE_MS = 60_000;

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
  return `${jsonTextFieldSql('payload_json', field, dialect)} = ?`;
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

export async function recordMissionSummaryChange(
  db: DatabaseClient,
  fields: {
    workspaceId: string;
    projectId: string;
    missionId: string;
    revision: number;
    operation: 'insert' | 'update';
    changedFields: string[];
    actorWorkspaceUserId: string | null;
    actorTokenId?: string | null;
    source: string;
  }
): Promise<void> {
  await insertEntityChange(db, {
    workspaceId: fields.workspaceId,
    projectId: fields.projectId,
    missionId: fields.missionId,
    entityType: 'mission_summary',
    entityId: fields.missionId,
    operation: fields.operation,
    entityRevision: fields.revision,
    changedFields: fields.changedFields,
    actorWorkspaceUserId: fields.actorWorkspaceUserId,
    actorTokenId: fields.actorTokenId ?? null,
    source: fields.source
  });
}

/** The summary row fields read under its lock. */
export type LockedMissionSummaryRow = {
  workspace_id: string;
  project_id: string;
  revision: number;
  content_revision: number;
  evidence_revision: number;
  published_evidence_revision: number | null;
  narrative_delivery_id: string | null;
  narrative_changed_at: string | null;
};

/**
 * Locks one mission's summary row (Postgres `FOR UPDATE`; SQLite serializes
 * writers already). Take the canonical mission lock first.
 */
export async function lockMissionSummaryRow(
  tx: DatabaseClient,
  missionId: string
): Promise<LockedMissionSummaryRow | null> {
  const lockClause = tx.dialect === 'postgres' ? 'FOR UPDATE' : '';
  const row = await tx.get<LockedMissionSummaryRow>(
    `SELECT workspace_id, project_id, revision, content_revision, evidence_revision,
            published_evidence_revision, narrative_delivery_id, narrative_changed_at
       FROM mission_summaries WHERE mission_id = ? ${lockClause}`,
    [missionId]
  );
  if (!row) return null;
  return {
    ...row,
    revision: Number(row.revision),
    content_revision: Number(row.content_revision),
    evidence_revision: Number(row.evidence_revision),
    published_evidence_revision:
      row.published_evidence_revision === null ? null : Number(row.published_evidence_revision),
    narrative_changed_at:
      row.narrative_changed_at === null
        ? null
        : new Date(String(row.narrative_changed_at as unknown)).toISOString()
  };
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

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

/**
 * Enqueue the brief job for one objective. Call it inside the transaction of
 * the write that left brief work pending (`title_status` or
 * `description_status = 'pending'`), after that write: on Postgres the write
 * holds the objective row lock, which {@link completeObjectiveBriefComposeJob}
 * also takes, so a request made while a job runs either is seen by that job's
 * completion (which queues a successor) or finds no active job and queues one.
 * The durable intent lives on the objective row, never in the payload, so
 * coalescing jobs cannot lose a request.
 *
 * - A queued job is reused. An automatic request pushes its `run_after` to
 *   `now + debounceMs` (a debounce), but never more than
 *   {@link OBJECTIVE_BRIEF_MAX_DEBOUNCE_MS} after the job was queued; an
 *   explicit request (`debounceMs = 0`) pulls it forward to now.
 * - A running job is left alone; its completion re-checks the row.
 */
export async function enqueueObjectiveBriefComposeJob({
  db,
  workspaceId,
  objectiveId,
  debounceMs = OBJECTIVE_BRIEF_DEBOUNCE_MS,
  now = nowIso(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  priority = DEFAULT_PRIORITY
}: {
  db: DatabaseClient;
  workspaceId: string;
  objectiveId: string;
  debounceMs?: number;
  now?: string;
  maxAttempts?: number;
  priority?: number;
}): Promise<{ jobId: string; enqueued: boolean }> {
  const runAfter = addMs(now, Math.max(0, debounceMs));
  const active = await db.get<{
    id: string;
    status: string;
    run_after: unknown;
    created_at: unknown;
  }>(
    `SELECT id, status, run_after, created_at FROM worker_jobs
      WHERE workspace_id = ?
        AND type = ?
        AND status IN ('queued', 'running')
        AND deleted_at IS NULL
        AND ${workerJobJsonFieldPredicate(db.dialect, 'objectiveId')}
      ORDER BY created_at ASC
      LIMIT 1`,
    [workspaceId, OBJECTIVE_BRIEF_COMPOSE_JOB_TYPE, objectiveId]
  );
  if (active) {
    if (active.status === 'queued') {
      const queuedAt = new Date(String(active.created_at as string | Date)).toISOString();
      const latest = addMs(queuedAt, OBJECTIVE_BRIEF_MAX_DEBOUNCE_MS);
      const target =
        debounceMs <= 0 ? now : runAfter < latest ? runAfter : latest > now ? latest : now;
      await db.run(
        `UPDATE worker_jobs SET run_after = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND status = 'queued'`,
        [target, now, active.id]
      );
    }
    return { jobId: active.id, enqueued: false };
  }

  const jobId = newId();
  await db.run(
    `INSERT INTO worker_jobs
         (id, workspace_id, type, status, priority, run_after, attempt_count, max_attempts,
          payload_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?, 1)`,
    [
      jobId,
      workspaceId,
      OBJECTIVE_BRIEF_COMPOSE_JOB_TYPE,
      priority,
      runAfter,
      maxAttempts,
      JSON.stringify({ objectiveId }),
      now,
      now
    ]
  );
  // Structured operational metric only; instruction text is never logged.
  console.info(
    '[objective-brief-compose-worker]',
    JSON.stringify({ event: 'objective_brief_queued', objectiveId, jobId, debounceMs })
  );
  return { jobId, enqueued: true };
}

/**
 * Finish a brief job under the objective row lock. If brief work is still
 * pending on the live row (an edit or request arrived while the job ran, or a
 * pass found its result stale), a successor job is queued in the same
 * transaction, so the latest generation is always processed.
 */
export async function completeObjectiveBriefComposeJob({
  db,
  jobId,
  objectiveId,
  status,
  lastError = null,
  now = nowIso()
}: {
  db: DatabaseClient;
  jobId: string;
  objectiveId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  lastError?: string | null;
  now?: string;
}): Promise<{ successorJobId: string | null }> {
  return db.transaction(async tx => {
    const lockClause = tx.dialect === 'postgres' ? 'FOR UPDATE' : '';
    const row = await tx.get<{
      workspace_id: string;
      title_status: string | null;
      description_status: string | null;
    }>(
      `SELECT workspace_id, title_status, description_status FROM objectives
        WHERE id = ? AND deleted_at IS NULL ${lockClause}`,
      [objectiveId]
    );
    await finishWorkerJob(tx, jobId, status, lastError, now);
    if (!row || (row.title_status !== 'pending' && row.description_status !== 'pending')) {
      return { successorJobId: null };
    }
    const successor = await enqueueObjectiveBriefComposeJob({
      db: tx,
      workspaceId: row.workspace_id,
      objectiveId,
      debounceMs: 0,
      now
    });
    return { successorJobId: successor.jobId };
  });
}
