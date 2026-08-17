import type { NotificationDto } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import { insertEntityChange } from '../packages/core/service/change-feed.ts';
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
  type NotificationType
} from '../packages/core/service/notifications/catalog.ts';
import { nowIso } from '../packages/core/service/util.ts';

import { requireDatabaseClient, resolveActiveProfileId } from './db.ts';
import { ApiError } from './errors.ts';
import { notificationBody, notificationSubject } from './notification-presentation.ts';

type NotificationRow = {
  id: string;
  workspace_id: string;
  recipient_profile_id: string;
  type: string;
  mission_id: string;
  objective_id: string | null;
  created_at: string;
  read_at: string | null;
  revision: number;
  deleted_at: string | null;
  project_id: string;
  mission_title: string;
  display_id: string;
  objective_display_key: string | null;
  objective_title: string | null;
};

function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

function toNotificationDto(row: NotificationRow): NotificationDto {
  if (!isNotificationType(row.type))
    throw new Error(`Invalid stored notification type: ${row.type}`);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    createdAt: row.created_at,
    readAt: row.read_at,
    revision: row.revision,
    // Keep user-authored text out of the durable row. This bounded projection is
    // recomputed from the current mission on every REST read, just as APNs
    // presentation is recomputed at dispatch time.
    presentation: {
      body: notificationBody(
        notificationSubject({
          missionDisplayId: row.display_id,
          missionTitle: row.mission_title,
          objectiveDisplayKey: row.objective_display_key,
          objectiveTitle: row.objective_title
        }),
        NOTIFICATION_CATALOG[row.type].verb
      )
    }
  };
}

async function activeNotificationProfileId(db: DatabaseClient): Promise<string> {
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required');
  return profileId;
}

async function ownedNotificationRow(
  db: DatabaseClient,
  profileId: string,
  id: string
): Promise<NotificationRow> {
  const row = await db.get<NotificationRow>(
    `SELECT n.id, n.workspace_id, n.recipient_profile_id, n.type, n.mission_id, n.objective_id,
            n.created_at, n.read_at, n.revision, n.deleted_at, m.project_id, m.title AS mission_title,
            m.display_id, o.display_key AS objective_display_key, o.title AS objective_title
       FROM notifications n
       JOIN missions m ON m.id = n.mission_id
       LEFT JOIN objectives o ON o.id = n.objective_id AND o.deleted_at IS NULL
      WHERE n.id = ? AND n.recipient_profile_id = ? AND n.deleted_at IS NULL`,
    [id, profileId]
  );
  if (!row) throw new ApiError(404, 'Notification not found');
  return row;
}

function expectedRevision(body: unknown): number {
  const revision = (body as { expectedRevision?: unknown } | null)?.expectedRevision;
  if (!Number.isInteger(revision) || (revision as number) < 1) {
    throw new ApiError(400, 'expectedRevision must be a positive integer');
  }
  return revision as number;
}

export async function listNotifications(): Promise<NotificationDto[]> {
  const db = requireDatabaseClient();
  const profileId = await activeNotificationProfileId(db);
  const rows = await db.all<NotificationRow>(
    `SELECT n.id, n.workspace_id, n.recipient_profile_id, n.type, n.mission_id, n.objective_id,
            n.created_at, n.read_at, n.revision, n.deleted_at, m.project_id, m.title AS mission_title,
            m.display_id, o.display_key AS objective_display_key, o.title AS objective_title
       FROM notifications n
       JOIN missions m ON m.id = n.mission_id
       LEFT JOIN objectives o ON o.id = n.objective_id AND o.deleted_at IS NULL
      WHERE n.recipient_profile_id = ? AND n.deleted_at IS NULL
      ORDER BY n.created_at DESC, n.id DESC`,
    [profileId]
  );
  return rows.map(toNotificationDto);
}

export async function markNotificationRead(id: string, body: unknown): Promise<NotificationDto> {
  const db = requireDatabaseClient();
  const profileId = await activeNotificationProfileId(db);
  const revision = expectedRevision(body);
  return db.transaction(async tx => {
    const existing = await ownedNotificationRow(tx, profileId, id);
    const now = nowIso();
    const nextRevision = existing.revision + 1;
    const updated = await tx.run(
      `UPDATE notifications SET read_at = ?, revision = ?
        WHERE id = ? AND recipient_profile_id = ? AND deleted_at IS NULL AND revision = ?`,
      [now, nextRevision, id, profileId, revision]
    );
    if (updated.changes === 0) throw new ApiError(409, 'Notification changed while marking read');
    await insertEntityChange(tx, {
      workspaceId: existing.workspace_id,
      projectId: existing.project_id,
      missionId: existing.mission_id,
      objectiveId: existing.objective_id,
      entityType: 'notification',
      entityId: id,
      operation: 'update',
      entityRevision: nextRevision,
      changedFields: ['read_at'],
      actorWorkspaceUserId: null,
      source: 'rest'
    });
    return toNotificationDto({ ...existing, read_at: now, revision: nextRevision });
  });
}

export async function dismissNotification(id: string, body: unknown): Promise<void> {
  const db = requireDatabaseClient();
  const profileId = await activeNotificationProfileId(db);
  const revision = expectedRevision(body);
  await db.transaction(async tx => {
    const existing = await ownedNotificationRow(tx, profileId, id);
    const now = nowIso();
    const nextRevision = existing.revision + 1;
    const updated = await tx.run(
      `UPDATE notifications SET deleted_at = ?, revision = ?
        WHERE id = ? AND recipient_profile_id = ? AND deleted_at IS NULL AND revision = ?`,
      [now, nextRevision, id, profileId, revision]
    );
    if (updated.changes === 0) throw new ApiError(409, 'Notification changed while dismissing');
    await insertEntityChange(tx, {
      workspaceId: existing.workspace_id,
      projectId: existing.project_id,
      missionId: existing.mission_id,
      objectiveId: existing.objective_id,
      entityType: 'notification',
      entityId: id,
      operation: 'delete',
      entityRevision: nextRevision,
      changedFields: ['deleted_at'],
      actorWorkspaceUserId: null,
      source: 'rest'
    });
  });
}
