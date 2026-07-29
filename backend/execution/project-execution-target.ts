import { type Permission, PERMISSIONS } from '@overlord/auth';
import type { DatabaseClient } from '@overlord/database';

import { ServiceError } from '../../packages/core/service/errors.ts';
import {
  deleteWorkspaceExecutionTarget,
  getProjectExecutionTargetSelection,
  listWorkspaceExecutionTargets,
  registerActingExecutionTarget,
  renameWorkspaceExecutionTarget,
  updateProjectExecutionTargetSelection,
  updateWorkspaceExecutionTargetStatus
} from '../../packages/core/service/project-execution-target.ts';
import type {
  ProjectExecutionTargetDto,
  UpdateProjectExecutionTargetBody,
  WorkspaceExecutionTargetDto
} from '../../webapp/shared/contract.ts';
import { buildWebappServiceContextForWorkspace, requireDatabaseClient } from '../db.ts';
import { ApiError } from '../errors.ts';
import { requireProjectPermission, requireWorkspacePermission } from '../rbac.ts';

/**
 * Project-target selection is a resource operation: resolve the project's
 * owning workspace and the caller's membership there before constructing the
 * service context. `buildWebappServiceContext()` uses the ambient workspace,
 * which is only correct for legacy active-workspace settings surfaces.
 */
async function projectServiceContext(
  projectId: string,
  permission: Permission,
  client: DatabaseClient
) {
  const { workspaceId, workspaceUserId } = await requireProjectPermission({
    projectId,
    permission,
    db: client
  });
  return buildWebappServiceContextForWorkspace(workspaceId, client, workspaceUserId);
}

function toDto(
  selection: Awaited<ReturnType<typeof getProjectExecutionTargetSelection>>
): ProjectExecutionTargetDto {
  return {
    selectedExecutionTargetId: selection.selectedExecutionTargetId,
    eligibleTargets: selection.eligibleTargets.map(target => ({
      executionTargetId: target.executionTargetId,
      type: target.type,
      label: target.label,
      deviceLabel: target.deviceLabel,
      reachable: target.reachable,
      primaryResourceConnected: target.primaryResourceConnected
    }))
  };
}

export async function getProjectExecutionTarget(
  projectId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<ProjectExecutionTargetDto> {
  try {
    const ctx = await projectServiceContext(projectId, PERMISSIONS.LAUNCH_READ, client);
    return toDto(await getProjectExecutionTargetSelection({ ctx, projectId }));
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) {
      throw new ApiError(404, 'Project not found');
    }
    throw error;
  }
}

/** Read-only workspace settings projection; access and target mutation stay on their existing flows. */
export async function getWorkspaceExecutionTargets(
  workspaceId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<WorkspaceExecutionTargetDto[]> {
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.WORKSPACE_READ,
    db: client
  });
  const ctx = await buildWebappServiceContextForWorkspace(workspaceId, client, workspaceUserId);
  return listWorkspaceExecutionTargets({ ctx });
}

/**
 * Declare the calling machine as an execution target in `workspaceId` — the
 * desktop app's one-click equivalent of `ovld add-et` (contract v39).
 *
 * Authorization matches the `register-target` protocol surface
 * (`execution_request:claim`), and the same machine-local eligibility rules apply:
 * a browser tab, the hosted backend host, or any caller with no machine identity is
 * refused with `409 no_execution_target_registered` rather than being declared.
 */
export async function registerWorkspaceExecutionTarget(
  workspaceId: string,
  body: { label?: unknown },
  client: DatabaseClient = requireDatabaseClient()
): Promise<WorkspaceExecutionTargetDto> {
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.EXECUTION_REQUEST_CLAIM,
    db: client,
    notFoundMessage: 'Workspace not found or no active membership'
  });
  const ctx = await buildWebappServiceContextForWorkspace(workspaceId, client, workspaceUserId);
  let registered: Awaited<ReturnType<typeof registerActingExecutionTarget>>;
  try {
    registered = await registerActingExecutionTarget({ ctx, label: label || null });
  } catch (error) {
    if (error instanceof ServiceError) {
      throw new ApiError(error.status, error.message, undefined, error.code);
    }
    throw error;
  }
  const targets = await listWorkspaceExecutionTargets({ ctx });
  const dto = targets.find(target => target.id === registered.executionTargetId);
  if (!dto) throw new ApiError(500, 'Execution target was registered but could not be read back');
  return dto;
}

export async function removeWorkspaceExecutionTarget(
  workspaceId: string,
  executionTargetId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<void> {
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.WORKSPACE_UPDATE,
    db: client
  });
  const ctx = await buildWebappServiceContextForWorkspace(workspaceId, client, workspaceUserId);
  try {
    await deleteWorkspaceExecutionTarget({ ctx, executionTargetId });
  } catch (error) {
    if (error instanceof ServiceError) {
      if (error.status === 404) throw new ApiError(404, 'Execution target not found');
      if (error.status === 409) throw new ApiError(409, error.message, undefined, error.code);
    }
    throw error;
  }
}

export async function updateWorkspaceExecutionTarget(
  workspaceId: string,
  executionTargetId: string,
  body: { label?: unknown; status?: unknown },
  client: DatabaseClient = requireDatabaseClient()
): Promise<WorkspaceExecutionTargetDto> {
  const label = typeof body.label === 'string' ? body.label : null;
  const status = body.status === 'active' || body.status === 'disabled' ? body.status : null;
  if (label === null && status === null) {
    throw new ApiError(400, 'Provide a label or status of active or disabled');
  }
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.WORKSPACE_UPDATE,
    db: client
  });
  const ctx = await buildWebappServiceContextForWorkspace(workspaceId, client, workspaceUserId);
  try {
    if (label !== null) {
      await renameWorkspaceExecutionTarget({ ctx, executionTargetId, label });
    }
    if (status !== null) {
      return await updateWorkspaceExecutionTargetStatus({ ctx, executionTargetId, status });
    }
    const targets = await listWorkspaceExecutionTargets({ ctx });
    const target = targets.find(entry => entry.id === executionTargetId);
    if (!target) throw new ServiceError('Execution target not found', 'not_found', 404);
    return target;
  } catch (error) {
    if (error instanceof ServiceError) {
      if (error.status === 404) throw new ApiError(404, 'Execution target not found');
      if (error.status === 400) throw new ApiError(400, error.message, undefined, error.code);
    }
    throw error;
  }
}

export async function updateProjectExecutionTarget(
  projectId: string,
  body: UpdateProjectExecutionTargetBody,
  client: DatabaseClient = requireDatabaseClient()
): Promise<ProjectExecutionTargetDto> {
  const executionTargetId =
    body.executionTargetId === undefined || body.executionTargetId === null
      ? null
      : body.executionTargetId.trim() || null;

  try {
    const ctx = await projectServiceContext(projectId, PERMISSIONS.LAUNCH_CONFIGURE, client);
    return toDto(
      await updateProjectExecutionTargetSelection({
        ctx,
        projectId,
        executionTargetId
      })
    );
  } catch (error) {
    if (error instanceof ServiceError) {
      if (error.status === 404) throw new ApiError(404, 'Project not found');
      if (error.status === 409) throw new ApiError(409, error.message);
      if (error.status === 400 && error.code === 'execution_target_not_eligible') {
        throw new ApiError(400, error.message, undefined, error.code);
      }
    }
    throw error;
  }
}
