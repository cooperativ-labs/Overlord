import type { DatabaseClient } from '@overlord/database';

import { newId, nowIso } from './util.js';

/** Durable backend job that recomputes one profile's private Live Activity snapshot. */
export const LIVE_ACTIVITY_DISPATCH_JOB_TYPE = 'overlord.live_activity.dispatch.v1';

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
  const owner = await db.get<{ profile_id: string }>(
    `SELECT wu.profile_id
       FROM missions m
       JOIN workspace_users wu ON wu.id = m.assigned_workspace_user_id
      WHERE m.id = ? AND m.workspace_id = ? AND m.deleted_at IS NULL
        AND wu.deleted_at IS NULL AND wu.status = 'active'`,
    [missionId, workspaceId]
  );
  return owner
    ? enqueueLiveActivityDispatchJob({ db, workspaceId, profileId: owner.profile_id, now })
    : false;
}
