import type { DatabaseClient } from '@overlord/database';

import { insertEntityChange } from '../packages/core/service/change-feed.ts';
import {
  NOTIFICATION_TYPES,
  type NotificationType,
  notificationTypesForTransport
} from '../packages/core/service/notifications/catalog.ts';
import {
  NOTIFICATION_DISPATCH_JOB_TYPE,
  type NotificationDispatchJobPayload
} from '../packages/core/service/notifications/notifications.ts';
import { isPushNotificationCategory } from '../packages/core/service/push-notification-jobs.ts';
import type { ClaimedWorkerJob } from '../packages/core/service/worker-jobs.ts';

import { requireDatabaseClient } from './db.ts';
import { deliverStandardPush } from './push-notification-dispatcher.ts';
import { resolveNotificationMode } from './push-notifications.ts';
import { WorkerJobPoller } from './worker-job-poller.ts';

type NotificationRow = {
  id: string;
  workspace_id: string;
  recipient_profile_id: string;
  type: string;
  mission_id: string;
  objective_id: string | null;
  revision: number;
  project_id: string;
};

function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

function parseJob(payloadJson: string): NotificationDispatchJobPayload | null {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof payload.notificationId === 'string' && payload.notificationId
      ? { notificationId: payload.notificationId }
      : null;
  } catch {
    return null;
  }
}

const REALTIME_NOTIFICATION_TYPES = new Set(notificationTypesForTransport('realtime'));

/**
 * Fans a durable notification row out to its eligible transports. This worker
 * deliberately reuses only the ordinary-device-token APNs transport; ActivityKit
 * update and push-to-start tokens remain owned by the live-activity dispatcher.
 */
class NotificationDispatcher extends WorkerJobPoller {
  constructor() {
    super({
      workerIdPrefix: 'notification',
      jobTypes: [NOTIFICATION_DISPATCH_JOB_TYPE],
      logPrefix: 'notification-dispatcher'
    });
  }

  protected databaseClient(): DatabaseClient {
    return requireDatabaseClient();
  }

  protected async processJob(db: DatabaseClient, job: ClaimedWorkerJob): Promise<void> {
    const payload = parseJob(job.payload_json);
    if (!payload) {
      await this.finishJob(db, job, 'failed', 'Malformed notification dispatch payload');
      return;
    }

    const row = await db.get<NotificationRow>(
      `SELECT n.id, n.workspace_id, n.recipient_profile_id, n.type, n.mission_id, n.objective_id,
              n.revision, m.project_id
         FROM notifications n
         JOIN missions m ON m.id = n.mission_id
        WHERE n.id = ? AND n.deleted_at IS NULL`,
      [payload.notificationId]
    );
    if (!row) {
      await this.finishJob(db, job);
      return;
    }
    if (!isNotificationType(row.type)) {
      await this.finishJob(db, job, 'failed', 'Invalid notification type');
      return;
    }

    // Device-token delivery remains isolated from ActivityKit. The catalog keeps
    // agent_started off this transport by construction.
    if (isPushNotificationCategory(row.type)) {
      const mode = await resolveNotificationMode(db, row.recipient_profile_id, row.type, 'apns');
      if (mode !== 'off') {
        await deliverStandardPush({
          db,
          profileId: row.recipient_profile_id,
          missionId: row.mission_id,
          category: row.type,
          mode
        });
      }
    }

    if (
      REALTIME_NOTIFICATION_TYPES.has(row.type) &&
      (await resolveNotificationMode(db, row.recipient_profile_id, row.type, 'realtime')) !== 'off'
    ) {
      await insertEntityChange(db, {
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        missionId: row.mission_id,
        objectiveId: row.objective_id,
        entityType: 'notification',
        entityId: row.id,
        operation: 'insert',
        entityRevision: row.revision,
        changedFields: [],
        actorWorkspaceUserId: null,
        source: 'notification_dispatcher'
      });
    }
    await this.finishJob(db, job);
  }
}

export const notificationDispatcher = new NotificationDispatcher();
export const __testables = { NotificationDispatcher };
