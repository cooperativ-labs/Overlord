import { type DatabaseClient, parseObjectiveRef } from '@overlord/database';

import {
  type ResolvedObjectiveRef,
  resolveObjectiveRef
} from '../packages/core/service/context.ts';
import { ServiceError } from '../packages/core/service/errors.ts';

import { buildWebappServiceContextForWorkspace, getResourceLookupWorkspaceIds } from './db.ts';
import { ApiError } from './errors.ts';

async function resolveObjectiveRefInWorkspace({
  ref,
  workspaceId,
  db,
  uuidWorkspaceScoped
}: {
  ref: string;
  workspaceId: string;
  db: DatabaseClient;
  uuidWorkspaceScoped: boolean;
}): Promise<ResolvedObjectiveRef> {
  const ctx = await buildWebappServiceContextForWorkspace(workspaceId, db);
  try {
    return await resolveObjectiveRef({ ctx, ref, uuidWorkspaceScoped });
  } catch (error) {
    if (error instanceof ServiceError) {
      throw new ApiError(error.status, error.message, undefined, error.code);
    }
    throw error;
  }
}

/**
 * Resolve an objective UUID or `{mission.display_id}.{display_key}` for REST.
 * UUIDs and public display ids resolve only inside the immutable authorized
 * workspace snapshot. A process-local Local call has no request snapshot, so
 * it derives the same boundary from the active operator's live memberships.
 */
export async function resolveObjectiveIdForRest({
  ref,
  db,
  uuidWorkspaceScoped = false
}: {
  ref: string;
  db: DatabaseClient;
  uuidWorkspaceScoped?: boolean;
}): Promise<ResolvedObjectiveRef> {
  const workspaceIds = await getResourceLookupWorkspaceIds(db);
  if (workspaceIds.length === 0) {
    throw new ApiError(404, 'Objective not found');
  }
  const parsed = parseObjectiveRef(ref);
  if (parsed.kind !== 'uuid' && parsed.kind !== 'display_id') {
    return resolveObjectiveRefInWorkspace({
      ref,
      workspaceId: workspaceIds[0]!,
      db,
      uuidWorkspaceScoped
    });
  }
  const rows =
    parsed.kind === 'display_id'
      ? await db.all<{ workspace_id: string }>(
          `SELECT workspace_id FROM missions
          WHERE display_id = ?
            AND workspace_id IN (${workspaceIds.map(() => '?').join(', ')})
            AND deleted_at IS NULL`,
          [parsed.missionDisplayId, ...workspaceIds]
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
  return resolveObjectiveRefInWorkspace({
    ref,
    workspaceId: rows[0].workspace_id,
    db,
    uuidWorkspaceScoped
  });
}
