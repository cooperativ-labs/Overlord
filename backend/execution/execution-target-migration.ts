import { PERMISSIONS } from '@overlord/auth';

import { loadExecutionTargetMigrationDiagnostics } from '../../packages/core/service/execution-target-migration.ts';
import { buildWebappServiceContextForWorkspace } from '../db.ts';
import { ApiError } from '../errors.ts';
import { requireWorkspacePermission } from '../rbac.ts';

export async function getExecutionTargetMigrationDiagnostics(workspaceId: string) {
  if (!workspaceId.trim()) throw new ApiError(400, 'workspaceId is required');
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.WORKSPACE_READ,
    notFoundMessage: 'Workspace not found'
  });

  return loadExecutionTargetMigrationDiagnostics({
    ctx: await buildWebappServiceContextForWorkspace(workspaceId, undefined, workspaceUserId)
  });
}
