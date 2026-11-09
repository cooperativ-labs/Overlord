import { PERMISSIONS } from '@overlord/auth';

import { buildWebappServiceContextForWorkspace, requireDatabaseClient } from '../db.ts';
import { ApiError } from '../errors.ts';
import { requireWorkspacePermission } from '../rbac.ts';

export async function requireExecutionTargetObservationContext(
  executionTargetId: string,
  deniedMessage: string
) {
  const db = requireDatabaseClient();
  const target = await db.get<{ workspace_id: string }>(
    `SELECT workspace_id FROM execution_targets WHERE id = ? AND deleted_at IS NULL`,
    [executionTargetId]
  );
  if (!target) throw new ApiError(404, 'Execution target not found');

  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: target.workspace_id,
    permission: [PERMISSIONS.LAUNCH_CONFIGURE, PERMISSIONS.EXECUTION_REQUEST_CLAIM],
    db,
    notFoundMessage: 'Execution target not found',
    deniedMessage
  });

  return buildWebappServiceContextForWorkspace(target.workspace_id, db, workspaceUserId);
}
