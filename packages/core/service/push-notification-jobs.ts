import type { DatabaseClient } from '@overlord/database';

import { newId, nowIso } from './util.js';

/**
 * Durable backend job that sends one standard APNs alert/background push.
 *
 * Deliberately distinct from `overlord.live_activity.dispatch.v1`: that surface
 * keeps a Lock Screen widget fresh with ActivityKit tokens, this one interrupts
 * a person with a banner using ordinary device tokens. They share the queue and
 * the APNs signer, never tokens, topics, or push types.
 */
export const PUSH_NOTIFICATION_DISPATCH_JOB_TYPE = 'overlord.push_notification.dispatch.v1';

/** Lifecycle-only categories. Progress updates and heartbeats never notify. */
export const PUSH_NOTIFICATION_CATEGORIES = [
  'mission_awaiting_review',
  'agent_question',
  'mission_complete',
  'mission_failed'
] as const;

export type PushNotificationCategory = (typeof PUSH_NOTIFICATION_CATEGORIES)[number];

/** Reserved master-switch category stored alongside the real ones. */
export const PUSH_NOTIFICATION_MASTER_CATEGORY = 'all';

export const PUSH_NOTIFICATION_MODES = ['alert', 'silent', 'off'] as const;

export type PushNotificationMode = (typeof PUSH_NOTIFICATION_MODES)[number];

export function isPushNotificationCategory(value: unknown): value is PushNotificationCategory {
  return (
    typeof value === 'string' && (PUSH_NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isPushNotificationMode(value: unknown): value is PushNotificationMode {
  return (
    typeof value === 'string' && (PUSH_NOTIFICATION_MODES as readonly string[]).includes(value)
  );
}

/** The job payload. Ids only — presentation is recomputed at delivery time. */
export type PushNotificationJobPayload = {
  profileId: string;
  missionId: string;
  objectiveId: string | null;
  category: PushNotificationCategory;
  dedupeKey: string;
};

function dedupePredicate(dialect: DatabaseClient['dialect']): string {
  return dialect === 'postgres'
    ? "payload_json->>'dedupeKey' = ?"
    : "json_extract(payload_json, '$.dedupeKey') = ?";
}

export function pushNotificationDedupeKey({
  profileId,
  category,
  missionId,
  objectiveId
}: {
  profileId: string;
  category: PushNotificationCategory;
  missionId: string;
  objectiveId?: string | null;
}): string {
  return `${profileId}:${category}:${missionId}:${objectiveId ?? '-'}`;
}

/**
 * Enqueue one standard push for one profile, skipping when an identical
 * notification is already queued or in flight. The payload carries only ids, so
 * a job that sits in the queue through several mutations still delivers the
 * state the recipient would see if they opened the app now.
 */
export async function enqueuePushNotificationJob({
  db,
  workspaceId,
  profileId,
  category,
  missionId,
  objectiveId = null,
  now = nowIso()
}: {
  db: DatabaseClient;
  workspaceId: string;
  profileId: string;
  category: PushNotificationCategory;
  missionId: string;
  objectiveId?: string | null;
  now?: string;
}): Promise<boolean> {
  const dedupeKey = pushNotificationDedupeKey({ profileId, category, missionId, objectiveId });
  const existing = await db.get<{ id: string }>(
    `SELECT id FROM worker_jobs
       WHERE workspace_id = ? AND type = ? AND status IN ('queued', 'running')
         AND deleted_at IS NULL AND ${dedupePredicate(db.dialect)}
       LIMIT 1`,
    [workspaceId, PUSH_NOTIFICATION_DISPATCH_JOB_TYPE, dedupeKey]
  );
  if (existing) return false;

  const payload: PushNotificationJobPayload = {
    profileId,
    missionId,
    objectiveId,
    category,
    dedupeKey
  };
  await db.run(
    `INSERT INTO worker_jobs
       (id, workspace_id, type, status, priority, run_after, attempt_count, max_attempts,
        payload_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, 'queued', 40, ?, 0, 5, ?, ?, ?, 1)`,
    [
      newId(),
      workspaceId,
      PUSH_NOTIFICATION_DISPATCH_JOB_TYPE,
      now,
      JSON.stringify(payload),
      now,
      now
    ]
  );
  return true;
}

/**
 * Notify the mission's assigned account only. Standard push is never broadcast
 * to a workspace: an unassigned mission produces no notification at all.
 */
export async function enqueuePushNotificationForMission({
  db,
  workspaceId,
  missionId,
  category,
  objectiveId = null,
  now = nowIso()
}: {
  db: DatabaseClient;
  workspaceId: string;
  missionId: string;
  category: PushNotificationCategory;
  objectiveId?: string | null;
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
    ? enqueuePushNotificationJob({
        db,
        workspaceId,
        profileId: owner.profile_id,
        category,
        missionId,
        objectiveId,
        now
      })
    : false;
}
