import type { DatabaseClient } from '@overlord/database';

import { resolveObjectiveRef } from '../packages/core/service/context.ts';
import { ServiceError } from '../packages/core/service/errors.ts';

import { buildWebappServiceContextForWorkspace, getAuthorizedWorkspacesContext } from './db.ts';
import { ApiError } from './errors.ts';

/**
 * Resolve an objective UUID or `{mission.display_id}.{display_key}` for REST.
 * UUIDs and public display ids resolve only inside the immutable authorized
 * workspace snapshot. Display ids are organization-unique, so this supports a
 * secondary workspace without consulting an ambient workspace default.
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
  const authorized = getAuthorizedWorkspacesContext();
  if (!authorized || authorized.workspaces.length === 0) {
    throw new ApiError(404, 'Objective not found');
  }
  const workspaceIds = authorized.workspaces.map(workspace => workspace.workspaceId);
  const parsedMissionDisplayId = ref.includes('.') ? ref.slice(0, ref.lastIndexOf('.')) : null;
  const rows = parsedMissionDisplayId
    ? await db.all<{ workspace_id: string }>(
        `SELECT workspace_id FROM missions
          WHERE display_id = ?
            AND workspace_id IN (${workspaceIds.map(() => '?').join(', ')})
            AND deleted_at IS NULL`,
        [parsedMissionDisplayId, ...workspaceIds]
      )
    : await db.all<{ workspace_id: string }>(
        `SELECT workspace_id FROM objectives
          WHERE id = ?
            AND workspace_id IN (${workspaceIds.map(() => '?').join(', ')})
            AND deleted_at IS NULL`,
        [ref, ...workspaceIds]
      );
  if (rows.length > 1) {
    throw new ApiError(409, `Objective reference is ambiguous in this organization: ${ref}`);
  }
  if (!rows[0]) throw new ApiError(404, 'Objective not found');
  const ctx = await buildWebappServiceContextForWorkspace(rows[0].workspace_id, db);
  try {
    return await resolveObjectiveRef({ ctx, ref, uuidWorkspaceScoped });
  } catch (error) {
    if (error instanceof ServiceError) {
      throw new ApiError(error.status, error.message, undefined, error.code);
    }
    throw error;
  }
}
