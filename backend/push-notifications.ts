import type { DatabaseClient } from '@overlord/database';

import {
  isPushNotificationCategory,
  isPushNotificationMode,
  PUSH_NOTIFICATION_CATEGORIES,
  PUSH_NOTIFICATION_MASTER_CATEGORY,
  type PushNotificationCategory,
  type PushNotificationMode
} from '../packages/core/service/push-notification-jobs.ts';
import { newId, nowIso } from '../packages/core/service/util.ts';

import { requireDatabaseClient, resolveActiveProfileId } from './db.ts';
import { ApiError } from './errors.ts';
import { bounded, presentationTitle } from './live-activities.ts';

const DEVICE_TOKEN_MAX_LENGTH = 512;
const BUNDLE_ID_MAX_LENGTH = 255;
const APP_VERSION_MAX_LENGTH = 64;
const PROJECT_NAME_MAX_LENGTH = 40;

/** Default when a profile has no stored row for a category. */
const DEFAULT_MODE: PushNotificationMode = 'alert';

export type DevicePushEnvironment = 'sandbox' | 'production';

export type NotificationPreferences = {
  enabled: boolean;
  categories: Array<{ category: PushNotificationCategory; mode: PushNotificationMode }>;
};

/**
 * Fixed per-category verbs. Never derived from user text, so a notification body
 * cannot be made to say something a category does not mean.
 */
const CATEGORY_VERBS: Record<PushNotificationCategory, string> = {
  mission_awaiting_review: 'is ready for review',
  agent_question: 'needs your input',
  mission_complete: 'finished',
  mission_failed: 'failed'
};

export type PushNotificationPresentation = {
  title: string;
  body: string;
  badge: number;
  missionId: string;
  category: PushNotificationCategory;
  deepLink: string;
};

// ---- Device token registration -------------------------------------------

type RegistrationBody = {
  deviceToken?: unknown;
  environment?: unknown;
  bundleId?: unknown;
  appVersion?: unknown;
};

function requiredString(value: unknown, field: string, max: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new ApiError(400, `${field} is required`);
  if (normalized.length > max) throw new ApiError(400, `${field} is too long`);
  return normalized;
}

/**
 * Registers or rotates the caller's standard APNs **device** token.
 *
 * A device token is globally unique and bound to exactly one profile: signing in
 * on a shared device must reassign the row rather than leave the previous
 * account receiving that device's notifications. Never pass an ActivityKit token
 * here — the two credentials are not interchangeable (see CONTRACT.md).
 */
export async function registerDevicePushToken(body: RegistrationBody): Promise<void> {
  const deviceToken = requiredString(body.deviceToken, 'deviceToken', DEVICE_TOKEN_MAX_LENGTH);
  const bundleId = requiredString(body.bundleId, 'bundleId', BUNDLE_ID_MAX_LENGTH);
  const environmentRaw = typeof body.environment === 'string' ? body.environment.trim() : '';
  if (environmentRaw !== 'sandbox' && environmentRaw !== 'production') {
    throw new ApiError(400, 'environment must be sandbox or production');
  }
  const environment: DevicePushEnvironment = environmentRaw;
  const appVersionRaw = typeof body.appVersion === 'string' ? body.appVersion.trim() : '';
  if (appVersionRaw.length > APP_VERSION_MAX_LENGTH) {
    throw new ApiError(400, 'appVersion is too long');
  }
  const appVersion = appVersionRaw || null;

  const db = requireDatabaseClient();
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required');

  const now = nowIso();
  await db.transaction(async tx => {
    const existing = await tx.get<{ id: string }>(
      `SELECT id FROM device_push_tokens WHERE device_token = ?`,
      [deviceToken]
    );
    if (existing) {
      // Reassignment is intentional: whoever most recently registered the device
      // owns it, so a stale account cannot keep receiving its alerts.
      await tx.run(
        `UPDATE device_push_tokens
            SET profile_id = ?, platform = 'ios', environment = ?, bundle_id = ?, app_version = ?,
                last_registered_at = ?, updated_at = ?
          WHERE id = ?`,
        [profileId, environment, bundleId, appVersion, now, now, existing.id]
      );
      return;
    }
    await tx.run(
      `INSERT INTO device_push_tokens
         (id, profile_id, device_token, platform, environment, bundle_id, app_version,
          last_registered_at, last_sent_at, created_at, updated_at)
       VALUES (?, ?, ?, 'ios', ?, ?, ?, ?, NULL, ?, ?)`,
      [newId(), profileId, deviceToken, environment, bundleId, appVersion, now, now, now]
    );
  });
}

/** Idempotently removes only the caller's own registration for this device. */
export async function revokeDevicePushToken(body: { deviceToken?: unknown }): Promise<void> {
  const deviceToken = requiredString(body.deviceToken, 'deviceToken', DEVICE_TOKEN_MAX_LENGTH);
  const db = requireDatabaseClient();
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required');
  await db.run(`DELETE FROM device_push_tokens WHERE profile_id = ? AND device_token = ?`, [
    profileId,
    deviceToken
  ]);
}

// ---- Preferences ----------------------------------------------------------

type PreferenceRow = { category: string; mode: string };

async function readPreferenceRows(db: DatabaseClient, profileId: string): Promise<PreferenceRow[]> {
  return db.all<PreferenceRow>(
    `SELECT category, mode FROM notification_preferences WHERE profile_id = ?`,
    [profileId]
  );
}

function toPreferences(rows: PreferenceRow[]): NotificationPreferences {
  const stored = new Map(rows.map(row => [row.category, row.mode]));
  return {
    enabled: stored.get(PUSH_NOTIFICATION_MASTER_CATEGORY) !== 'off',
    categories: PUSH_NOTIFICATION_CATEGORIES.map(category => {
      const mode = stored.get(category);
      return { category, mode: isPushNotificationMode(mode) ? mode : DEFAULT_MODE };
    })
  };
}

/** Reads the caller's own preferences, filling absent rows with the default. */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const db = requireDatabaseClient();
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required');
  return toPreferences(await readPreferenceRows(db, profileId));
}

type PreferencesBody = { enabled?: unknown; categories?: unknown };

/**
 * Merges a partial preference update. Omitted categories keep their stored
 * value; unknown categories or modes are rejected rather than silently dropped,
 * so a client bug cannot quietly disable a user's alerts.
 */
export async function updateNotificationPreferences(
  body: PreferencesBody
): Promise<NotificationPreferences> {
  const updates: Array<{ category: string; mode: PushNotificationMode }> = [];

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'enabled must be a boolean');
    updates.push({
      category: PUSH_NOTIFICATION_MASTER_CATEGORY,
      mode: body.enabled ? 'alert' : 'off'
    });
  }

  if (body.categories !== undefined) {
    if (!Array.isArray(body.categories)) throw new ApiError(400, 'categories must be an array');
    for (const entry of body.categories) {
      const record = (entry ?? {}) as { category?: unknown; mode?: unknown };
      if (!isPushNotificationCategory(record.category)) {
        throw new ApiError(400, 'Unknown notification category');
      }
      if (!isPushNotificationMode(record.mode)) {
        throw new ApiError(400, 'Unknown notification mode');
      }
      updates.push({ category: record.category, mode: record.mode });
    }
  }

  const db = requireDatabaseClient();
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required');

  if (updates.length === 0) return toPreferences(await readPreferenceRows(db, profileId));

  const now = nowIso();
  await db.transaction(async tx => {
    for (const update of updates) {
      const existing = await tx.get<{ id: string }>(
        `SELECT id FROM notification_preferences WHERE profile_id = ? AND category = ?`,
        [profileId, update.category]
      );
      if (existing) {
        await tx.run(`UPDATE notification_preferences SET mode = ?, updated_at = ? WHERE id = ?`, [
          update.mode,
          now,
          existing.id
        ]);
      } else {
        await tx.run(
          `INSERT INTO notification_preferences (id, profile_id, category, mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [newId(), profileId, update.category, update.mode, now, now]
        );
      }
    }
  });

  return toPreferences(await readPreferenceRows(db, profileId));
}

/**
 * Resolves the effective delivery mode for one category, honouring the master
 * switch. Used by the dispatcher, not by any REST read.
 */
export async function resolveNotificationMode(
  db: DatabaseClient,
  profileId: string,
  category: PushNotificationCategory
): Promise<PushNotificationMode> {
  const preferences = toPreferences(await readPreferenceRows(db, profileId));
  if (!preferences.enabled) return 'off';
  return preferences.categories.find(entry => entry.category === category)?.mode ?? DEFAULT_MODE;
}

// ---- Presentation --------------------------------------------------------

type MissionPresentationRow = {
  id: string;
  title: string;
  display_id: string;
  project_name: string;
};

/**
 * Recomputes the payload snapshot from the database at delivery time.
 *
 * This is an allowlist by construction: project name, sanitized mission title,
 * display id, badge count, mission id, category, and deep link. Objective
 * instructions, agent prompts, delivery summaries, question text, file paths and
 * `mission_events.payload_json` are deliberately never read here — APNs sees
 * payload contents in transit, so anything not needed to decide whether to open
 * the app stays out. Returns `null` when the mission is no longer visible to the
 * recipient, which also drops an already-queued notification.
 */
export async function buildPushNotificationPresentation({
  db,
  profileId,
  missionId,
  category
}: {
  db: DatabaseClient;
  profileId: string;
  missionId: string;
  category: PushNotificationCategory;
}): Promise<PushNotificationPresentation | null> {
  const mission = await db.get<MissionPresentationRow>(
    `SELECT m.id, m.title, m.display_id, p.name AS project_name
       FROM missions m
       JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
       JOIN workspace_users wu ON wu.id = m.assigned_workspace_user_id
      WHERE m.id = ? AND m.deleted_at IS NULL AND wu.profile_id = ?
        AND wu.status = 'active' AND wu.deleted_at IS NULL`,
    [missionId, profileId]
  );
  if (!mission) return null;

  const badgeRow = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM missions m
       JOIN workspace_users wu ON wu.id = m.assigned_workspace_user_id
      WHERE m.deleted_at IS NULL AND m.status_type = 'review'
        AND wu.profile_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL`,
    [profileId]
  );

  const title = presentationTitle(mission.title) || 'Untitled mission';
  return {
    title: bounded(mission.project_name.trim() || 'Project', PROJECT_NAME_MAX_LENGTH),
    body: `${mission.display_id}: ${title} ${CATEGORY_VERBS[category]}`,
    badge: Number(badgeRow?.count ?? 0),
    missionId: mission.id,
    category,
    deepLink: `overlord://missions/${mission.id}`
  };
}
