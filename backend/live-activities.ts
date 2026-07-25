import type { DatabaseClient } from '@overlord/database';
import { createHash } from 'node:crypto';

import { enqueueLiveActivityDispatchJob } from '../packages/core/service/live-activity-jobs.ts';
import { newId, nowIso } from '../packages/core/service/util.ts';

import { requireDatabaseClient, resolveActiveProfileId } from './db.ts';
import { ApiError } from './errors.ts';

const MAX_RUNNING = 2;
const COMPLETION_HOLD_MS = 30 * 60 * 1000;
const TITLE_MAX_LENGTH = 80;

export type LiveActivityMissionSnapshot = {
  id: string;
  title: string;
  displayId: string;
  projectName: string;
  projectColorHex: string;
};

export type LiveActivityContentState = {
  running: LiveActivityMissionSnapshot[];
  recentCompletion: LiveActivityMissionSnapshot | null;
  updatedAt: string;
};

type RegistrationBody = { pushToken?: unknown };
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

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function presentationTitle(value: string): string {
  return bounded(
    value
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/^[#>\-+*]\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim(),
    TITLE_MAX_LENGTH
  );
}

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
    projectColorHex: projectColor(row.project_settings_json)
  };
}

/** Registers or rotates an opaque ActivityKit push token for the signed-in profile. */
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

  const db = requireDatabaseClient();
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required');
  const workspace = await db.get<{ id: string }>(
    `SELECT w.id FROM workspace_users wu JOIN workspaces w ON w.id = wu.workspace_id
      WHERE wu.profile_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL
        AND w.deleted_at IS NULL ORDER BY wu.created_at ASC LIMIT 1`,
    [profileId]
  );
  if (!workspace) throw new ApiError(403, 'No active workspace membership');

  const now = nowIso();
  await db.transaction(async tx => {
    const existing = await tx.get<{ id: string }>(
      `SELECT id FROM live_activity_push_tokens WHERE profile_id = ? AND activity_id = ?`,
      [profileId, normalizedActivityId]
    );
    if (existing) {
      await tx.run(
        `UPDATE live_activity_push_tokens
            SET push_token = ?, last_content_hash = NULL, last_sent_at = NULL, updated_at = ?
          WHERE id = ?`,
        [pushToken, now, existing.id]
      );
    } else {
      await tx.run(
        `INSERT INTO live_activity_push_tokens
           (id, profile_id, activity_id, push_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId(), profileId, normalizedActivityId, pushToken, now, now]
      );
    }
    await enqueueLiveActivityDispatchJob({
      db: tx,
      workspaceId: workspace.id,
      profileId,
      now
    });
  });
}

/** Idempotently removes only the signed-in account's matching activity registration. */
export async function revokeLiveActivityPushToken(activityId: string): Promise<void> {
  const normalizedActivityId = activityId.trim();
  if (!normalizedActivityId) throw new ApiError(400, 'activityId is required');
  const db = requireDatabaseClient();
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required');
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
            EXISTS(SELECT 1 FROM objectives o WHERE o.mission_id = m.id AND o.deleted_at IS NULL AND o.state = 'executing') AS has_executing_objective,
            EXISTS(SELECT 1 FROM objectives o WHERE o.mission_id = m.id AND o.deleted_at IS NULL AND o.state = 'complete') AS has_completed_objective
       FROM missions m
       JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
       JOIN workspace_users wu ON wu.id = m.assigned_workspace_user_id
       JOIN workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
      WHERE m.deleted_at IS NULL AND wu.profile_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL
      ORDER BY m.updated_at DESC, m.id ASC`,
    [profileId]
  );
  const running = rows.filter(row => asBool(row.has_executing_objective)).slice(0, MAX_RUNNING);
  const completion = rows.find(row => {
    if (asBool(row.has_executing_objective)) return false;
    if (!asBool(row.has_completed_objective) && row.status_type !== 'complete') return false;
    const updated = Date.parse(row.updated_at);
    return Number.isFinite(updated) && now.getTime() - updated <= COMPLETION_HOLD_MS;
  });
  if (running.length === 0 && !completion) return null;
  return {
    running: running.map(toSnapshot),
    recentCompletion: completion ? toSnapshot(completion) : null,
    updatedAt: now.toISOString()
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
