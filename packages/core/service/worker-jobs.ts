import type { DatabaseClient } from '@overlord/database';

import { insertEntityChange } from './change-feed.js';
import type { ServiceContext } from './context.js';
import { jsonTextFieldSql, newId, nowIso } from './util.js';

/** Core-documented worker job type for asynchronous delivery presentation composition. */
export const DELIVERY_COMPOSE_JOB_TYPE = 'overlord.delivery.compose.v1';

/** Core-documented worker job type for the operator-only mission summary (coo:1202). */
export const MISSION_SUMMARY_COMPOSE_JOB_TYPE = 'overlord.mission.summary.compose.v1';

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

/** Why a mission summary compose was requested; logged as a bounded metric only. */
export type MissionSummaryComposeReason =
  | 'delivery_presented'
  | 'deferred_work_resolved'
  | 'deferred_work_reopened'
  | 'agent_request_opened'
  | 'agent_request_closed'
  | 'objective_reopened';

/**
 * The write context a mission summary trigger records its change under. The
 * protocol path passes its ServiceContext; the REST layer, which has no
 * ServiceContext, passes the same fields explicitly.
 */
export type MissionSummaryTriggerContext =
  | ServiceContext
  | {
      db: DatabaseClient;
      workspaceId: string;
      actorWorkspaceUserId: string | null;
      actorTokenId?: string | null;
      source: ServiceContext['source'];
    };

function triggerWorkspaceId(ctx: MissionSummaryTriggerContext): string {
  return 'workspace' in ctx ? ctx.workspace.id : ctx.workspaceId;
}

function isSummaryEnabled(value: unknown): boolean {
  return value === true || Number(value) === 1;
}

async function recordMissionSummaryChange(
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

/**
 * Requests a fresh mission summary. Call it inside the transaction of the
 * write it follows. A no-op for an ineligible (pre-cutover) or missing mission.
 *
 * Never discards a trigger: `requested_generation` increments atomically on
 * every call, even while a job is queued or running, and the row moves to
 * `pending` while keeping its previous content. The first trigger creates an
 * empty pending shell. The upsert takes the summary row lock before the active
 * job check, and job completion ({@link completeMissionSummaryComposeJob})
 * takes the same lock before finishing the job, so a trigger either sees an
 * active job that will notice the newer generation or leaves a queued job.
 */
export async function enqueueMissionSummaryComposeJob({
  ctx,
  missionId,
  reason,
  sourceDeliveryId = null,
  now = nowIso(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  priority = DEFAULT_PRIORITY
}: {
  ctx: MissionSummaryTriggerContext;
  missionId: string;
  reason: MissionSummaryComposeReason;
  sourceDeliveryId?: string | null;
  now?: string;
  maxAttempts?: number;
  priority?: number;
}): Promise<{ triggered: boolean; generation: number | null; jobId: string | null }> {
  const db = ctx.db;
  const workspaceId = triggerWorkspaceId(ctx);
  const mission = await db.get<{ project_id: string; summary_enabled: unknown }>(
    `SELECT project_id, summary_enabled FROM missions
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [missionId, workspaceId]
  );
  if (!mission || !isSummaryEnabled(mission.summary_enabled)) {
    return { triggered: false, generation: null, jobId: null };
  }

  const row = await db.get<{ revision: number; requested_generation: number }>(
    `INSERT INTO mission_summaries
         (mission_id, workspace_id, project_id, revision, requested_generation,
          completed_generation, status, headline, summary_markdown, risks_json,
          suggestions_json, source_delivery_id, generated_by, generated_at, model,
          created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, 0, 'pending', '', '', '[]', '[]', ?, 'deterministic', NULL, NULL, ?, ?)
       ON CONFLICT (mission_id) DO UPDATE SET
         requested_generation = mission_summaries.requested_generation + 1,
         revision = mission_summaries.revision + 1,
         status = 'pending',
         source_delivery_id = excluded.source_delivery_id,
         updated_at = excluded.updated_at
       RETURNING revision, requested_generation`,
    [missionId, workspaceId, mission.project_id, sourceDeliveryId, now, now]
  );
  const revision = Number(row?.revision ?? 1);
  const generation = Number(row?.requested_generation ?? 1);
  await recordMissionSummaryChange(db, {
    workspaceId,
    projectId: mission.project_id,
    missionId,
    revision,
    operation: revision === 1 ? 'insert' : 'update',
    changedFields: ['status', 'requested_generation'],
    actorWorkspaceUserId: ctx.actorWorkspaceUserId,
    actorTokenId: ctx.actorTokenId ?? null,
    source: ctx.source
  });

  const result = await enqueueWorkerJob({
    db,
    workspaceId,
    type: MISSION_SUMMARY_COMPOSE_JOB_TYPE,
    dedupeBy: { field: 'missionId', value: missionId },
    payload: { missionId },
    priority,
    maxAttempts,
    now
  });
  // Structured operational metric only; summary content is never logged.
  console.info(
    '[mission-summary-compose-worker]',
    JSON.stringify({
      event: 'mission_summary_requested',
      missionId,
      reason,
      generation,
      jobId: result.jobId,
      enqueued: result.enqueued
    })
  );
  return { triggered: true, generation, jobId: result.jobId };
}

/** The generation a compose pass works towards, read with its evidence snapshot. */
export type MissionSummaryGeneration = {
  workspaceId: string;
  projectId: string;
  requestedGeneration: number;
  completedGeneration: number;
  sourceDeliveryId: string | null;
  previous: { headline: string; summary: string } | null;
};

export async function readMissionSummaryGeneration(
  db: DatabaseClient,
  missionId: string
): Promise<MissionSummaryGeneration | null> {
  const row = await db.get<{
    workspace_id: string;
    project_id: string;
    requested_generation: number;
    completed_generation: number;
    source_delivery_id: string | null;
    headline: string;
    summary_markdown: string;
  }>(
    `SELECT workspace_id, project_id, requested_generation, completed_generation,
            source_delivery_id, headline, summary_markdown
       FROM mission_summaries WHERE mission_id = ?`,
    [missionId]
  );
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    requestedGeneration: Number(row.requested_generation),
    completedGeneration: Number(row.completed_generation),
    sourceDeliveryId: row.source_delivery_id,
    previous: row.headline.trim() ? { headline: row.headline, summary: row.summary_markdown } : null
  };
}

async function lockMissionSummaryRow(
  tx: DatabaseClient,
  missionId: string
): Promise<{
  workspace_id: string;
  project_id: string;
  revision: number;
  requested_generation: number;
  completed_generation: number;
} | null> {
  const lockClause = tx.dialect === 'postgres' ? 'FOR UPDATE' : '';
  return (
    (await tx.get<{
      workspace_id: string;
      project_id: string;
      revision: number;
      requested_generation: number;
      completed_generation: number;
    }>(
      `SELECT workspace_id, project_id, revision, requested_generation, completed_generation
         FROM mission_summaries WHERE mission_id = ? ${lockClause}`,
      [missionId]
    )) ?? null
  );
}

/** Content written by a guarded publication; risks and suggestions are references. */
export type MissionSummaryPublication = {
  status: 'composed' | 'fallback';
  headline: string;
  summary: string;
  risks: unknown[];
  suggestions: unknown[];
  sourceDeliveryId: string | null;
  generatedBy: 'deterministic' | 'gemini';
  model: string | null;
};

/**
 * Publishes a compose result only if no trigger arrived since `generation` was
 * captured. Returns `stale` without writing when the counter moved, so the
 * caller composes again from current evidence instead of publishing an older
 * result over a newer request.
 */
export async function publishMissionSummary({
  db,
  missionId,
  generation,
  publication,
  now = nowIso()
}: {
  db: DatabaseClient;
  missionId: string;
  generation: number;
  publication: MissionSummaryPublication;
  now?: string;
}): Promise<'published' | 'stale' | 'missing'> {
  return db.transaction(async tx => {
    const row = await lockMissionSummaryRow(tx, missionId);
    if (!row) return 'missing';
    if (
      Number(row.requested_generation) !== generation ||
      Number(row.completed_generation) >= generation
    )
      return 'stale';
    const revision = Number(row.revision) + 1;
    await tx.run(
      `UPDATE mission_summaries
          SET status = ?, headline = ?, summary_markdown = ?, risks_json = ?,
              suggestions_json = ?, source_delivery_id = ?, generated_by = ?,
              generated_at = ?, model = ?, completed_generation = ?, revision = ?,
              updated_at = ?
        WHERE mission_id = ? AND requested_generation = ?`,
      [
        publication.status,
        publication.headline,
        publication.summary,
        JSON.stringify(publication.risks),
        JSON.stringify(publication.suggestions),
        publication.sourceDeliveryId,
        publication.generatedBy,
        now,
        publication.model,
        generation,
        revision,
        now,
        missionId,
        generation
      ]
    );
    await recordMissionSummaryChange(tx, {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      missionId,
      revision,
      operation: 'update',
      changedFields: [
        'status',
        'headline',
        'summary_markdown',
        'risks_json',
        'suggestions_json',
        'completed_generation'
      ],
      actorWorkspaceUserId: null,
      source: 'runner'
    });
    return 'published';
  });
}

/**
 * Finishes a mission summary job under the summary row lock. If a trigger
 * arrived after the last publication (`requested_generation` ahead of
 * `completed_generation`), a successor job is queued in the same transaction,
 * so no trigger is lost between publication and job completion.
 */
export async function completeMissionSummaryComposeJob({
  db,
  jobId,
  missionId,
  status,
  lastError = null,
  now = nowIso()
}: {
  db: DatabaseClient;
  jobId: string;
  missionId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  lastError?: string | null;
  now?: string;
}): Promise<{ successorJobId: string | null }> {
  return db.transaction(async tx => {
    const row = await lockMissionSummaryRow(tx, missionId);
    await finishWorkerJob(tx, jobId, status, lastError, now);
    if (!row || Number(row.requested_generation) <= Number(row.completed_generation)) {
      return { successorJobId: null };
    }
    const successor = await enqueueWorkerJob({
      db: tx,
      workspaceId: row.workspace_id,
      type: MISSION_SUMMARY_COMPOSE_JOB_TYPE,
      dedupeBy: { field: 'missionId', value: missionId },
      payload: { missionId },
      now
    });
    return { successorJobId: successor.jobId };
  });
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
