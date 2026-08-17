import type { DatabaseClient } from '@overlord/database';

import { resolveObjectiveRef } from '../packages/core/service/context.ts';
import { ServiceError } from '../packages/core/service/errors.ts';

import { buildWebappServiceContextForWorkspace, getActiveWorkspaceId } from './db.ts';
import { ApiError } from './errors.ts';

/**
 * Resolve an objective UUID or `{mission.display_id}.{display_key}` for REST.
 * UUIDs are looked up globally (coo:135); display ids are scoped to the active
 * workspace, matching `requireMissionPermission`.
 */
export async function resolveObjectiveIdForRest({
  ref,
  db,
  uuidWorkspaceScoped = false
}: {
  ref: string;
  db: DatabaseClient;
  uuidWorkspaceScoped?: boolean;
}): Promise<{
  id: string;
  workspaceId: string;
  displayId: string;
  displayKey: string;
  missionId: string;
  projectId: string;
}> {
  const ctx = await buildWebappServiceContextForWorkspace(getActiveWorkspaceId(), db);
  try {
    return await resolveObjectiveRef({ ctx, ref, uuidWorkspaceScoped });
  } catch (error) {
    if (error instanceof ServiceError) {
      throw new ApiError(error.status, error.message, undefined, error.code);
    }
    throw error;
  }
}
