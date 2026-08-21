import type { DatabaseClient } from '@overlord/database';
import { formatObjectiveDisplayId } from '@overlord/database';
import { createHash } from 'node:crypto';

import { enqueueLiveActivityDispatchJob } from '../packages/core/service/live-activity-jobs.ts';
import { newId, nowIso } from '../packages/core/service/util.ts';

import { requireDatabaseClient, resolveActiveProfileId } from './db.ts';
import { ApiError } from './errors.ts';
import { bounded, presentationTitle } from './text-presentation.ts';

// Re-exported so existing importers (push notifications, tests) keep one source
// for bounded APNs text while the helpers themselves stay free of database imports.
export { bounded, presentationTitle };

const MAX_RUNNING = 2;
const COMPLETION_HOLD_MS = 30 * 60 * 1000;
const START_TOKEN_MAX_LENGTH = 512;
const BUNDLE_ID_MAX_LENGTH = 255;
const ACTIVITY_TYPE_MAX_LENGTH = 128;
const APP_VERSION_MAX_LENGTH = 64;

/** Static ActivityKit attributes for the account-level mission activity. */
export const LIVE_ACTIVITY_ATTRIBUTES_TYPE = 'OverlordActivityAttributes';
export const LIVE_ACTIVITY_ACCOUNT_LABEL = 'My Missions';

/**
 * One live row of the account activity. Objective-first (coo:756 §9.4): `title`
 * and `displayId` name the **objective** whenever the row has one, so two runs
 * of the same mission are distinguishable on the Lock Screen. `id` stays the
 * mission id because it is the activity's navigation target, and the mission's
 * own identity is carried alongside as secondary context — older app builds that
 * only read `title`/`displayId` therefore pick up objective text with no
 * ActivityKit attribute change.
 */
export type LiveActivityMissionSnapshot = {
  id: string;
  title: string;
  displayId: string;
  projectName: string;
  projectColorHex: string;
  /** The objective this row is about, or `null` for a mission-grain row. */
  objectiveId: string | null;
  missionDisplayId: string;
  missionTitle: string;
};

export type LiveActivityContentState = {
  running: LiveActivityMissionSnapshot[];
  recentCompletion: LiveActivityMissionSnapshot | null;
  /** Unix epoch seconds. ActivityKit's push JSONDecoder cannot parse ISO-8601. */
  updatedAt: number;
};

type RegistrationBody = {
  pushToken?: unknown;
  environment?: unknown;
  bundleId?: unknown;
  startedByPush?: unknown;
};
type StartTokenBody = {
  startToken?: unknown;
  environment?: unknown;
  bundleId?: unknown;
  activityType?: unknown;
  appVersion?: unknown;
};
export type LiveActivityStartEnvironment = 'sandbox' | 'production';
export type LiveActivityPushEnvironment = LiveActivityStartEnvironment;
type SnapshotRow = {
  id: string;
  title: string;
  display_id: string;
  project_name: string;
  project_settings_json: string;
  updated_at: string;
  has_executing_objective: number | boolean;
  has_completed_objective: number | boolean;
  status_type: string;
};

/** A running objective plus the mission context it is displayed under. */
type RunningObjectiveRow = {
  objective_id: string;
  objective_title: string | null;
  display_key: string;
  mission_id: string;
  mission_title: string;
  mission_display_id: string;
  project_name: string;
  project_settings_json: string;
};

function projectColor(settingsJson: string): string {
  try {
    const value = JSON.parse(settingsJson) as Record<string, unknown>;
    const configured = value['overlord.color'] ?? value.color;
    const color = typeof configured === 'string' ? configured.trim() : '';
    return color ? (color.startsWith('#') ? color : `#${color}`) : '#2563eb';
  } catch {
    return '#2563eb';
  }
}

function asBool(value: number | boolean): boolean {
  return value === true || value === 1;
}

function toSnapshot(row: SnapshotRow): LiveActivityMissionSnapshot {
  return {
    id: row.id,
    title: presentationTitle(row.title),
    displayId: row.display_id,
    projectName: bounded(row.project_name.trim() || 'Project', 40),
    projectColorHex: projectColor(row.project_settings_json),
    objectiveId: null,
    missionDisplayId: row.display_id,
    missionTitle: presentationTitle(row.title)
  };
}

function toRunningSnapshot(row: RunningObjectiveRow): LiveActivityMissionSnapshot {
  const missionTitle = presentationTitle(row.mission_title);
  // An objective with no title of its own still gets its own display id; the
  // mission title is the closest human label available for it.
  const objectiveTitle = row.objective_title ? presentationTitle(row.objective_title) : '';
  return {
    id: row.mission_id,
    title: objectiveTitle || missionTitle,
    displayId: formatObjectiveDisplayId({
      missionDisplayId: row.mission_display_id,
      displayKey: row.display_key
    }),
    projectName: bounded(row.project_name.trim() || 'Project', 40),
    projectColorHex: projectColor(row.project_settings_json),
    objectiveId: row.objective_id,
    missionDisplayId: row.mission_display_id,
    missionTitle
  };
}

/**
 * The completion row names the objective that just finished, when one can be
 * identified, so the "just finished" line reads in the same grain as the running
 * rows. A mission that completed with no completed objective (status moved by
 * hand) keeps the mission-grain snapshot.
 */
async function toCompletionSnapshot(
  db: DatabaseClient,
  row: SnapshotRow
): Promise<LiveActivityMissionSnapshot> {
  const objective = await db.get<{
    id: string;
    title: string | null;
    display_key: string;
  }>(
    `SELECT id, title, display_key FROM objectives
      WHERE mission_id = ? AND deleted_at IS NULL AND state = 'complete'
      ORDER BY updated_at DESC, id ASC LIMIT 1`,
    [row.id]
  );
  const mission = toSnapshot(row);
  if (!objective) return mission;
  return {
    ...mission,
    title: (objective.title ? presentationTitle(objective.title) : '') || mission.missionTitle,
    displayId: formatObjectiveDisplayId({
      missionDisplayId: row.display_id,
      displayKey: objective.display_key
    }),
    objectiveId: objective.id
  };
}

function requiredString(value: unknown, field: string, max: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new ApiError(400, `${field} is required`);
  if (normalized.length > max) throw new ApiError(400, `${field} is too long`);
  return normalized;
}

/** The caller's oldest active membership, used only to address the durable job. */
async function requireOwnWorkspaceId(db: DatabaseClient, profileId: string): Promise<string> {
  const workspace = await db.get<{ id: string }>(
    `SELECT w.id FROM workspace_users wu JOIN workspaces w ON w.id = wu.workspace_id
      WHERE wu.profile_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL
        AND w.deleted_at IS NULL ORDER BY wu.created_at ASC LIMIT 1`,
    [profileId]
  );
  if (!workspace) throw new ApiError(403, 'No active workspace membership');
  return workspace.id;
}

async function requireOwnProfileId(db: DatabaseClient): Promise<string> {
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required');
  return profileId;
}

/**
 * Registers or rotates an opaque ActivityKit push token for the signed-in profile.
 *
 * `startedByPush` marks the handoff case: APNs remotely started the activity, and
 * this is the per-activity **update** token the system handed the app afterwards.
 * Recording the origin is what stops the start worker from starting a second
 * activity for an account that already has one on screen.
 */
export async function registerLiveActivityPushToken(
  activityId: string,
  body: RegistrationBody
): Promise<void> {
  const normalizedActivityId = activityId.trim();
  const pushToken = typeof body.pushToken === 'string' ? body.pushToken.trim() : '';
  if (!normalizedActivityId || !pushToken) {
    throw new ApiError(400, 'activityId and pushToken are required');
  }
  if (normalizedActivityId.length > 255 || pushToken.length > 4096) {
    throw new ApiError(400, 'Live Activity registration is too large');
  }
  const bundleId = requiredString(body.bundleId, 'bundleId', BUNDLE_ID_MAX_LENGTH);
  const environmentRaw = typeof body.environment === 'string' ? body.environment.trim() : '';
  if (environmentRaw !== 'sandbox' && environmentRaw !== 'production') {
    throw new ApiError(400, 'environment must be sandbox or production');
  }
  const environment: LiveActivityPushEnvironment = environmentRaw;
  if (body.startedByPush !== undefined && typeof body.startedByPush !== 'boolean') {
    throw new ApiError(400, 'startedByPush must be a boolean');
  }
  const origin = body.startedByPush === true ? 'push_to_start' : 'local';

  const db = requireDatabaseClient();
  const profileId = await requireOwnProfileId(db);
  const workspaceId = await requireOwnWorkspaceId(db, profileId);

  const now = nowIso();
  await db.transaction(async tx => {
    const existing = await tx.get<{ id: string }>(
      `SELECT id FROM live_activity_push_tokens WHERE profile_id = ? AND activity_id = ?`,
      [profileId, normalizedActivityId]
    );
    if (existing) {
      await tx.run(
        `UPDATE live_activity_push_tokens
            SET push_token = ?, environment = ?, bundle_id = ?, origin = ?,
                last_content_hash = NULL, last_sent_at = NULL, updated_at = ?
          WHERE id = ?`,
        [pushToken, environment, bundleId, origin, now, existing.id]
      );
    } else {
      await tx.run(
        `INSERT INTO live_activity_push_tokens
           (id, profile_id, activity_id, push_token, environment, bundle_id, origin,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          profileId,
          normalizedActivityId,
          pushToken,
          environment,
          bundleId,
          origin,
          now,
          now
        ]
      );
    }
    await enqueueLiveActivityDispatchJob({
      db: tx,
      workspaceId,
      profileId,
      now
    });
  });
}

/**
 * Registers or rotates the caller's opaque ActivityKit **push-to-start** token.
 *
 * Uploading this token is itself the consent record for desktop-initiated Live
 * Activities: with no row the server can never remotely start one, so revoking
 * is how a user turns the feature off. A start token is globally unique per
 * (install, activity type) and belongs to exactly one profile at a time, so
 * signing in on a shared device reassigns the row rather than leaving the
 * previous account able to start activities on it. Never pass a device token or
 * a per-activity update token here — the three are not interchangeable.
 */
export async function registerLiveActivityStartToken(body: StartTokenBody): Promise<void> {
  const startToken = requiredString(body.startToken, 'startToken', START_TOKEN_MAX_LENGTH);
  const bundleId = requiredString(body.bundleId, 'bundleId', BUNDLE_ID_MAX_LENGTH);
  const environmentRaw = typeof body.environment === 'string' ? body.environment.trim() : '';
  if (environmentRaw !== 'sandbox' && environmentRaw !== 'production') {
    throw new ApiError(400, 'environment must be sandbox or production');
  }
  const environment: LiveActivityStartEnvironment = environmentRaw;
  const activityTypeRaw = typeof body.activityType === 'string' ? body.activityType.trim() : '';
  if (activityTypeRaw.length > ACTIVITY_TYPE_MAX_LENGTH) {
    throw new ApiError(400, 'activityType is too long');
  }
  const activityType = activityTypeRaw || LIVE_ACTIVITY_ATTRIBUTES_TYPE;
  const appVersionRaw = typeof body.appVersion === 'string' ? body.appVersion.trim() : '';
  if (appVersionRaw.length > APP_VERSION_MAX_LENGTH) {
    throw new ApiError(400, 'appVersion is too long');
  }
  const appVersion = appVersionRaw || null;

  const db = requireDatabaseClient();
  const profileId = await requireOwnProfileId(db);

  const now = nowIso();
  await db.transaction(async tx => {
    const existing = await tx.get<{ id: string }>(
      `SELECT id FROM live_activity_start_tokens WHERE start_token = ?`,
      [startToken]
    );
    if (existing) {
      await tx.run(
        `UPDATE live_activity_start_tokens
            SET profile_id = ?, platform = 'ios', environment = ?, bundle_id = ?,
                activity_type = ?, app_version = ?, last_registered_at = ?, updated_at = ?
          WHERE id = ?`,
        [profileId, environment, bundleId, activityType, appVersion, now, now, existing.id]
      );
      return;
    }
    await tx.run(
      `INSERT INTO live_activity_start_tokens
         (id, profile_id, start_token, platform, environment, bundle_id, activity_type,
          app_version, last_registered_at, last_started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'ios', ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        newId(),
        profileId,
        startToken,
        environment,
        bundleId,
        activityType,
        appVersion,
        now,
        now,
        now
      ]
    );
  });
}

/** Idempotently removes only the caller's own push-to-start registration. */
export async function revokeLiveActivityStartToken(body: { startToken?: unknown }): Promise<void> {
  const startToken = requiredString(body.startToken, 'startToken', START_TOKEN_MAX_LENGTH);
  const db = requireDatabaseClient();
  const profileId = await requireOwnProfileId(db);
  await db.run(`DELETE FROM live_activity_start_tokens WHERE profile_id = ? AND start_token = ?`, [
    profileId,
    startToken
  ]);
}

/** Idempotently removes only the signed-in account's matching activity registration. */
export async function revokeLiveActivityPushToken(activityId: string): Promise<void> {
  const normalizedActivityId = activityId.trim();
  if (!normalizedActivityId) throw new ApiError(400, 'activityId is required');
  const db = requireDatabaseClient();
  const profileId = await requireOwnProfileId(db);
  await db.run(`DELETE FROM live_activity_push_tokens WHERE profile_id = ? AND activity_id = ?`, [
    profileId,
    normalizedActivityId
  ]);
}

/** Recomputes the same bounded presentation state used by the mobile mapper. */
export async function buildLiveActivityContentState(
  db: DatabaseClient,
  profileId: string,
  now = new Date()
): Promise<LiveActivityContentState | null> {
  const rows = await db.all<SnapshotRow>(
    `SELECT m.id, m.title, m.display_id, p.name AS project_name, p.settings_json AS project_settings_json,
            m.updated_at, m.status_type,
            EXISTS(SELECT 1 FROM objectives o WHERE o.mission_id = m.id AND o.deleted_at IS NULL AND o.state IN ('executing', 'pending_delivery')) AS has_executing_objective,
            EXISTS(SELECT 1 FROM objectives o WHERE o.mission_id = m.id AND o.deleted_at IS NULL AND o.state = 'complete') AS has_completed_objective
       FROM missions m
       JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
       JOIN workspace_users wu ON wu.id = m.assigned_workspace_user_id
       JOIN workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
      WHERE m.deleted_at IS NULL AND wu.profile_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL
      ORDER BY m.updated_at DESC, m.id ASC`,
    [profileId]
  );
  // Running rows are one per **executing objective**, not one per mission: the
  // cap of two is about how much work is on screen, and two objectives of one
  // mission are two different things happening. `pending_delivery` is included
  // because the agent has re-attached and is still on the objective.
  const runningRows = await db.all<RunningObjectiveRow>(
    `SELECT o.id AS objective_id, o.title AS objective_title, o.display_key,
            m.id AS mission_id, m.title AS mission_title, m.display_id AS mission_display_id,
            p.name AS project_name, p.settings_json AS project_settings_json
       FROM objectives o
       JOIN missions m ON m.id = o.mission_id AND m.deleted_at IS NULL
       JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
       JOIN workspace_users wu ON wu.id = m.assigned_workspace_user_id
       JOIN workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
      WHERE o.deleted_at IS NULL AND o.state IN ('executing', 'pending_delivery')
        AND wu.profile_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL
      ORDER BY o.updated_at DESC, o.id ASC`,
    [profileId]
  );
  const running = runningRows.slice(0, MAX_RUNNING);
  const completion = rows.find(row => {
    if (asBool(row.has_executing_objective)) return false;
    if (!asBool(row.has_completed_objective) && row.status_type !== 'complete') return false;
    const updated = Date.parse(row.updated_at);
    return Number.isFinite(updated) && now.getTime() - updated <= COMPLETION_HOLD_MS;
  });
  if (running.length === 0 && !completion) return null;
  return {
    running: running.map(toRunningSnapshot),
    recentCompletion: completion ? await toCompletionSnapshot(db, completion) : null,
    updatedAt: Math.floor(now.getTime() / 1000)
  };
}

export function liveActivityContentHash(state: LiveActivityContentState | null): string {
  // `updatedAt` changes on every recomputation but is not visible content; including
  // it would defeat the five-minute unchanged-progress coalescing rule.
  return createHash('sha256')
    .update(
      JSON.stringify(
        state && {
          running: state.running,
          recentCompletion: state.recentCompletion
        }
      )
    )
    .digest('hex');
}
