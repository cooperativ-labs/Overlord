import type { DatabaseClient } from '@overlord/database';

import { newId, nowIso } from '../util.js';
import { enqueueWorkerJob, missionOwnerProfileId } from '../worker-jobs.js';

import type { NotificationType } from './catalog.js';

/** Durable fan-out job for one already-persisted notification row. */
export const NOTIFICATION_DISPATCH_JOB_TYPE = 'overlord.notification.dispatch.v1';

export type NotificationDispatchJobPayload = {
  notificationId: string;
};

/**
 * Persist a server-owned notification and queue its transport fan-out as part
 * of the caller's domain transaction. Assignment is the only addressing rule:
 * an unassigned mission deliberately creates neither a row nor a job.
 */
export async function emitNotification({
  db,
  workspaceId,
  missionId,
  objectiveId = null,
  type,
  now = nowIso()
}: {
  db: DatabaseClient;
  workspaceId: string;
  missionId: string;
  objectiveId?: string | null;
  type: NotificationType;
  now?: string;
}): Promise<{ notificationId: string | null; emitted: boolean }> {
  const recipientProfileId = await missionOwnerProfileId({ db, workspaceId, missionId });
  if (!recipientProfileId) return { notificationId: null, emitted: false };

  const notificationId = newId();
  await db.run(
    `INSERT INTO notifications
         (id, workspace_id, recipient_profile_id, type, mission_id, objective_id,
          created_at, read_at, revision, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL)`,
    [notificationId, workspaceId, recipientProfileId, type, missionId, objectiveId, now]
  );

  await enqueueWorkerJob({
    db,
    workspaceId,
    type: NOTIFICATION_DISPATCH_JOB_TYPE,
    dedupeBy: { field: 'notificationId', value: notificationId },
    payload: { notificationId } satisfies NotificationDispatchJobPayload,
    priority: 40,
    maxAttempts: 5,
    now
  });

  return { notificationId, emitted: true };
}
