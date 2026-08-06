import type { DatabaseClient } from '@overlord/database';

import { newId, nowIso } from './util.js';

/** Durable backend job that recomputes one profile's private Live Activity snapshot. */
export const LIVE_ACTIVITY_DISPATCH_JOB_TYPE = 'overlord.live_activity.dispatch.v1';

/**
 * Durable backend job that asks APNs to *start* a Live Activity on the assigned
 * account's devices when a mission enters execution from the desktop.
 *
 * Kept separate from the dispatch job rather than folded into it: a start is
 * sent on a push-to-start token, is only legal while no activity exists, and
 * must not be coalesced with the ordinary update stream that keeps an
 * already-running activity fresh.
 */
export const LIVE_ACTIVITY_START_JOB_TYPE = 'overlord.live_activity.start.v1';

function profilePredicate(dialect: DatabaseClient['dialect']): string {
  return dialect === 'postgres'
    ? "payload_json->>'profileId' = ?"
    : "json_extract(payload_json, '$.profileId') = ?";
}

/**
 * Coalesce active refreshes for a profile. The worker deliberately recomputes
 * at delivery time, so a job payload never carries Lock Screen content.
 */
export async function enqueueLiveActivityDispatchJob({
  db,
  workspaceId,
  profileId,
  now = nowIso()
}: {
  db: DatabaseClient;
  workspaceId: string;
  profileId: string;
  now?: string;
}): Promise<boolean> {
  const existing = await db.get<{ id: string }>(
    `SELECT id FROM worker_jobs
       WHERE workspace_id = ? AND type = ? AND status IN ('queued', 'running')
         AND deleted_at IS NULL AND ${profilePredicate(db.dialect)}
       LIMIT 1`,
    [workspaceId, LIVE_ACTIVITY_DISPATCH_JOB_TYPE, profileId]
  );
  if (existing) return false;

  await db.run(
    `INSERT INTO worker_jobs
       (id, workspace_id, type, status, priority, run_after, attempt_count, max_attempts,
        payload_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, 'queued', 40, ?, 0, 5, ?, ?, ?, 1)`,
    [
      newId(),
      workspaceId,
      LIVE_ACTIVITY_DISPATCH_JOB_TYPE,
      now,
      JSON.stringify({ profileId }),
      now,
      now
    ]
  );
  return true;
}

async function missionOwnerProfileId({
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

/** Queue the account that owns the affected mission, if it has an assignee. */
export async function enqueueLiveActivityRefreshForMission({
  db,
  workspaceId,
  missionId,
  now = nowIso()
}: {
  db: DatabaseClient;
  workspaceId: string;
  missionId: string;
  now?: string;
}): Promise<boolean> {
  const profileId = await missionOwnerProfileId({ db, workspaceId, missionId });
  return profileId ? enqueueLiveActivityDispatchJob({ db, workspaceId, profileId, now }) : false;
}

/**
 * Coalesce start attempts per profile. Like the dispatch job the payload carries
 * only the target profile and the mission that triggered it; the worker decides
 * at delivery time whether a start is still warranted and recomputes the
 * content state then, so a queued job never carries Lock Screen content.
 */
export async function enqueueLiveActivityStartJob({
  db,
  workspaceId,
  profileId,
  missionId,
  now = nowIso()
}: {
  db: DatabaseClient;
  workspaceId: string;
  profileId: string;
  missionId: string;
  now?: string;
}): Promise<boolean> {
  const existing = await db.get<{ id: string }>(
    `SELECT id FROM worker_jobs
       WHERE workspace_id = ? AND type = ? AND status IN ('queued', 'running')
         AND deleted_at IS NULL AND ${profilePredicate(db.dialect)}
       LIMIT 1`,
    [workspaceId, LIVE_ACTIVITY_START_JOB_TYPE, profileId]
  );
  if (existing) return false;

  await db.run(
    `INSERT INTO worker_jobs
       (id, workspace_id, type, status, priority, run_after, attempt_count, max_attempts,
        payload_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, 'queued', 40, ?, 0, 5, ?, ?, ?, 1)`,
    [
      newId(),
      workspaceId,
      LIVE_ACTIVITY_START_JOB_TYPE,
      now,
      JSON.stringify({ profileId, missionId }),
      now,
      now
    ]
  );
  return true;
}

/**
 * A mission entered execution: refresh any activity that is already on screen
 * and, for the same assigned account, ask APNs to start one if none exists.
 * Unassigned missions notify nobody — assignment is the addressing rule for
 * every push surface.
 */
export async function enqueueLiveActivityStartForMission({
  db,
  workspaceId,
  missionId,
  now = nowIso()
}: {
  db: DatabaseClient;
  workspaceId: string;
  missionId: string;
  now?: string;
}): Promise<boolean> {
  const profileId = await missionOwnerProfileId({ db, workspaceId, missionId });
  if (!profileId) return false;
  await enqueueLiveActivityDispatchJob({ db, workspaceId, profileId, now });
  return enqueueLiveActivityStartJob({ db, workspaceId, profileId, missionId, now });
}
