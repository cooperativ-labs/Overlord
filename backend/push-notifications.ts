import type { NotificationPreferenceDto, NotificationPreferencesDto } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_TRANSPORTS,
  NOTIFICATION_TYPES,
  type NotificationTransport,
  type NotificationType
} from '../packages/core/service/notifications/catalog.ts';
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

export type NotificationPreferences = NotificationPreferencesDto;

/**
 * Fixed per-category verbs. Never derived from user text, so a notification body
 * cannot be made to say something a category does not mean.
 */
const CATEGORY_VERBS: Record<PushNotificationCategory, string> = Object.fromEntries(
  PUSH_NOTIFICATION_CATEGORIES.map(category => [category, NOTIFICATION_CATALOG[category].verb])
) as Record<PushNotificationCategory, string>;

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

type PreferenceRow = { type: string; transport: string; mode: string };

type PreferenceUpdate = {
  type: NotificationType | typeof PUSH_NOTIFICATION_MASTER_CATEGORY;
  transport: NotificationTransport | 'all';
  mode: PushNotificationMode;
};

async function readPreferenceRows(db: DatabaseClient, profileId: string): Promise<PreferenceRow[]> {
  return db.all<PreferenceRow>(
    `SELECT type, transport, mode FROM notification_preferences WHERE profile_id = ?`,
    [profileId]
  );
}

function preferenceKey(type: string, transport: string): string {
  return `${type}:${transport}`;
}

function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

function isNotificationTransport(value: unknown): value is NotificationTransport {
  return (
    typeof value === 'string' && (NOTIFICATION_TRANSPORTS as readonly string[]).includes(value)
  );
}

function isEligibleTransport(type: NotificationType, transport: NotificationTransport): boolean {
  return (NOTIFICATION_CATALOG[type].transports as readonly NotificationTransport[]).includes(
    transport
  );
}

function toPreferences(rows: PreferenceRow[]): NotificationPreferences {
  const stored = new Map(rows.map(row => [preferenceKey(row.type, row.transport), row.mode]));
  const preferences: NotificationPreferenceDto[] = NOTIFICATION_TYPES.flatMap(type =>
    (NOTIFICATION_CATALOG[type].transports as readonly NotificationTransport[]).map(transport => {
      const mode = stored.get(preferenceKey(type, transport));
      return {
        type,
        transport,
        mode: isPushNotificationMode(mode) ? mode : NOTIFICATION_CATALOG[type].defaultMode
      };
    })
  );
  return {
    enabled: stored.get(preferenceKey(PUSH_NOTIFICATION_MASTER_CATEGORY, 'all')) !== 'off',
    preferences,
    // This projection lets released iOS builds continue decoding and updating
    // their existing APNs-only controls while newer clients use `preferences`.
    categories: PUSH_NOTIFICATION_CATEGORIES.map(category => {
      const mode = stored.get(preferenceKey(category, 'apns'));
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

/**
 * Merges a partial preference update. Omitted entries keep their stored value;
 * unknown types, transports, pairs, or modes are rejected rather than silently
 * dropped. `categories` remains an APNs-only compatibility alias for released
 * mobile clients; new callers use the transport-specific `preferences` array.
 */
type PreferencesBody = { enabled?: unknown; preferences?: unknown; categories?: unknown };

export async function updateNotificationPreferences(
  body: PreferencesBody
): Promise<NotificationPreferences> {
  const updates: PreferenceUpdate[] = [];

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'enabled must be a boolean');
    updates.push({
      type: PUSH_NOTIFICATION_MASTER_CATEGORY,
      transport: 'all',
      mode: body.enabled ? 'alert' : 'off'
    });
  }

  if (body.preferences !== undefined) {
    if (!Array.isArray(body.preferences)) throw new ApiError(400, 'preferences must be an array');
    for (const entry of body.preferences) {
      const record = (entry ?? {}) as { type?: unknown; transport?: unknown; mode?: unknown };
      if (!isNotificationType(record.type)) throw new ApiError(400, 'Unknown notification type');
      if (!isNotificationTransport(record.transport)) {
        throw new ApiError(400, 'Unknown notification transport');
      }
      if (!isEligibleTransport(record.type, record.transport)) {
        throw new ApiError(400, 'Notification type is not eligible for this transport');
      }
      if (!isPushNotificationMode(record.mode)) {
        throw new ApiError(400, 'Unknown notification mode');
      }
      updates.push({ type: record.type, transport: record.transport, mode: record.mode });
    }
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
      updates.push({ type: record.category, transport: 'apns', mode: record.mode });
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
        `SELECT id FROM notification_preferences
          WHERE profile_id = ? AND type = ? AND transport = ?`,
        [profileId, update.type, update.transport]
      );
      if (existing) {
        await tx.run(`UPDATE notification_preferences SET mode = ?, updated_at = ? WHERE id = ?`, [
          update.mode,
          now,
          existing.id
        ]);
      } else {
        await tx.run(
          `INSERT INTO notification_preferences
             (id, profile_id, type, transport, mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [newId(), profileId, update.type, update.transport, update.mode, now, now]
        );
      }
    }
  });

  return toPreferences(await readPreferenceRows(db, profileId));
}

/**
 * Resolves the effective delivery mode for one type/transport pair, honouring
 * the master switch. Used by dispatchers, not by REST reads.
 */
export async function resolveNotificationMode(
  db: DatabaseClient,
  profileId: string,
  type: NotificationType,
  transport: NotificationTransport
): Promise<PushNotificationMode> {
  const preferences = toPreferences(await readPreferenceRows(db, profileId));
  if (!preferences.enabled) return 'off';
  return (
    preferences.preferences.find(entry => entry.type === type && entry.transport === transport)
      ?.mode ?? NOTIFICATION_CATALOG[type].defaultMode
  );
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

  // Icon badge = unread durable notifications for this profile (same definition
  // the mobile drawer and web history use). Missions-in-review is a different
  // queue metric and must not drive the home-screen badge.
  const badgeRow = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM notifications
      WHERE recipient_profile_id = ?
        AND deleted_at IS NULL
        AND read_at IS NULL`,
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
