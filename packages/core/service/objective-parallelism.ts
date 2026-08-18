import {
  canonicalObjectiveResourceKey,
  DEFAULT_PRIMARY_RESOURCE_KEY,
  PARALLEL_BLOCKING_OBJECTIVE_STATES,
  siblingBlocksParallelLaunch
} from '@overlord/automations';
import { bindBool } from '@overlord/database';

import type { ServiceContext } from './context.js';
import { ACTIVE_EXECUTION_REQUEST_STATUSES } from './execution-requests.js';

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1;
}

export async function missionAllowsParallelObjectives({
  ctx,
  missionId
}: {
  ctx: ServiceContext;
  missionId: string;
}): Promise<boolean> {
  const row = (await ctx.db.get(
    `SELECT allow_parallel_objectives FROM missions
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [missionId, ctx.workspace.id]
  )) as { allow_parallel_objectives: unknown } | undefined;
  return isTruthyFlag(row?.allow_parallel_objectives);
}

export async function primaryResourceKeyForProject({
  ctx,
  projectId
}: {
  ctx: ServiceContext;
  projectId: string;
}): Promise<string> {
  const row = (await ctx.db.get(
    `SELECT resource_key FROM project_resources
      WHERE project_id = ? AND workspace_id = ? AND deleted_at IS NULL AND is_primary = ?
      LIMIT 1`,
    [projectId, ctx.workspace.id, bindBool(ctx.db.dialect, true)]
  )) as { resource_key: string | null } | undefined;
  return row?.resource_key?.trim() || DEFAULT_PRIMARY_RESOURCE_KEY;
}

export async function countActiveMissionObjectives({
  ctx,
  missionId
}: {
  ctx: ServiceContext;
  missionId: string;
}): Promise<number> {
  const row = (await ctx.db.get(
    `SELECT COUNT(*) AS n FROM objectives
      WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
        AND state IN (${PARALLEL_BLOCKING_OBJECTIVE_STATES.map(() => '?').join(', ')})`,
    [missionId, ctx.workspace.id, ...PARALLEL_BLOCKING_OBJECTIVE_STATES]
  )) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/**
 * Sibling that would 409 a launch of `objectiveId`. Flag off: any active
 * sibling. Flag on: only a sibling whose effective resource_key matches.
 */
export async function findConflictingActiveSibling({
  ctx,
  missionId,
  projectId,
  objectiveId,
  resourceKey,
  allowParallelObjectives
}: {
  ctx: ServiceContext;
  missionId: string;
  projectId: string;
  objectiveId: string;
  resourceKey: string | null | undefined;
  allowParallelObjectives: boolean;
}): Promise<{ id: string } | null> {
  const primaryResourceKey = allowParallelObjectives
    ? await primaryResourceKeyForProject({ ctx, projectId })
    : DEFAULT_PRIMARY_RESOURCE_KEY;
  const candidateKey = canonicalObjectiveResourceKey(resourceKey, primaryResourceKey);

  const siblings = (await ctx.db.all(
    `SELECT id, resource_key FROM objectives
      WHERE mission_id = ? AND workspace_id = ? AND id <> ? AND deleted_at IS NULL
        AND state IN (${PARALLEL_BLOCKING_OBJECTIVE_STATES.map(() => '?').join(', ')})`,
    [missionId, ctx.workspace.id, objectiveId, ...PARALLEL_BLOCKING_OBJECTIVE_STATES]
  )) as Array<{ id: string; resource_key: string | null }>;

  for (const sibling of siblings) {
    if (
      siblingBlocksParallelLaunch({
        allowParallelObjectives,
        candidateResourceKey: candidateKey,
        siblingResourceKey: sibling.resource_key,
        primaryResourceKey
      })
    ) {
      return { id: sibling.id };
    }
  }

  const requestSiblings = (await ctx.db.all(
    `SELECT o.id, o.resource_key
       FROM execution_requests er
       JOIN objectives o ON o.id = er.objective_id AND o.deleted_at IS NULL
      WHERE er.mission_id = ? AND er.workspace_id = ? AND er.objective_id <> ?
        AND er.deleted_at IS NULL
        AND er.status IN (${ACTIVE_EXECUTION_REQUEST_STATUSES.map(() => '?').join(', ')})
        AND o.state IN (${PARALLEL_BLOCKING_OBJECTIVE_STATES.map(() => '?').join(', ')})`,
    [
      missionId,
      ctx.workspace.id,
      objectiveId,
      ...ACTIVE_EXECUTION_REQUEST_STATUSES,
      ...PARALLEL_BLOCKING_OBJECTIVE_STATES
    ]
  )) as Array<{ id: string; resource_key: string | null }>;

  for (const sibling of requestSiblings) {
    if (
      siblingBlocksParallelLaunch({
        allowParallelObjectives,
        candidateResourceKey: candidateKey,
        siblingResourceKey: sibling.resource_key,
        primaryResourceKey
      })
    ) {
      return { id: sibling.id };
    }
  }

  return null;
}
