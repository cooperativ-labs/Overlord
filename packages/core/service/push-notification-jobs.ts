import type { DatabaseClient } from '@overlord/database';

import {
  NOTIFICATION_MODES,
  type NotificationMode,
  type NotificationTypeForTransport,
  notificationTypesForTransport
} from './notifications/catalog.js';
import { nowIso } from './util.js';
import { enqueueWorkerJob, missionOwnerProfileId } from './worker-jobs.js';

/**
 * Durable backend job that sends one standard APNs alert/background push.
 *
 * Deliberately distinct from `overlord.live_activity.dispatch.v1`: that surface
 * keeps a Lock Screen widget fresh with ActivityKit tokens, this one interrupts
 * a person with a banner using ordinary device tokens. They share the queue and
 * the APNs signer, never tokens, topics, or push types.
 */
export const PUSH_NOTIFICATION_DISPATCH_JOB_TYPE = 'overlord.push_notification.dispatch.v1';

/** Lifecycle-only categories eligible for the existing standard APNs transport. */
export const PUSH_NOTIFICATION_CATEGORIES = notificationTypesForTransport('apns');

export type PushNotificationCategory = NotificationTypeForTransport<'apns'>;

/** Reserved master-switch category stored alongside the real ones. */
export const PUSH_NOTIFICATION_MASTER_CATEGORY = 'all';

export const PUSH_NOTIFICATION_MODES = NOTIFICATION_MODES;

export type PushNotificationMode = NotificationMode;

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
  const payload: PushNotificationJobPayload = {
    profileId,
    missionId,
    objectiveId,
    category,
    dedupeKey
  };
  const result = await enqueueWorkerJob({
    db,
    workspaceId,
    type: PUSH_NOTIFICATION_DISPATCH_JOB_TYPE,
    dedupeBy: { field: 'dedupeKey', value: dedupeKey },
    payload,
    priority: 40,
    maxAttempts: 5,
    now
  });
  return result.enqueued;
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
  const profileId = await missionOwnerProfileId({ db, workspaceId, missionId });
  return profileId
    ? enqueuePushNotificationJob({
        db,
        workspaceId,
        profileId,
        category,
        missionId,
        objectiveId,
        now
      })
    : false;
}
