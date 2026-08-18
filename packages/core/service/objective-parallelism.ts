import { PARALLEL_BLOCKING_OBJECTIVE_STATES } from '@overlord/automations';

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
 * sibling (or any objective holding an active execution request). Flag on:
 * none — concurrent objectives on the same resource are separated by the Runner
 * Layer's per-objective branch/worktree isolation, or share the mission's single
 * checkout when the mission runs without worktrees.
 */
export async function findConflictingActiveSibling({
  ctx,
  missionId,
  objectiveId,
  allowParallelObjectives
}: {
  ctx: ServiceContext;
  missionId: string;
  /** Accepted for call-site symmetry with the launch path; no longer read. */
  projectId?: string;
  objectiveId: string;
  /** Accepted for call-site symmetry with the launch path; no longer read. */
  resourceKey?: string | null;
  allowParallelObjectives: boolean;
}): Promise<{ id: string } | null> {
  if (allowParallelObjectives) return null;

  const sibling = (await ctx.db.get(
    `SELECT id FROM objectives
      WHERE mission_id = ? AND workspace_id = ? AND id <> ? AND deleted_at IS NULL
        AND state IN (${PARALLEL_BLOCKING_OBJECTIVE_STATES.map(() => '?').join(', ')})
      LIMIT 1`,
    [missionId, ctx.workspace.id, objectiveId, ...PARALLEL_BLOCKING_OBJECTIVE_STATES]
  )) as { id: string } | undefined;
  if (sibling) return { id: sibling.id };

  const requestSibling = (await ctx.db.get(
    `SELECT o.id
       FROM execution_requests er
       JOIN objectives o ON o.id = er.objective_id AND o.deleted_at IS NULL
      WHERE er.mission_id = ? AND er.workspace_id = ? AND er.objective_id <> ?
        AND er.deleted_at IS NULL
        AND er.status IN (${ACTIVE_EXECUTION_REQUEST_STATUSES.map(() => '?').join(', ')})
        AND o.state IN (${PARALLEL_BLOCKING_OBJECTIVE_STATES.map(() => '?').join(', ')})
      LIMIT 1`,
    [
      missionId,
      ctx.workspace.id,
      objectiveId,
      ...ACTIVE_EXECUTION_REQUEST_STATUSES,
      ...PARALLEL_BLOCKING_OBJECTIVE_STATES
    ]
  )) as { id: string } | undefined;
  return requestSibling ? { id: requestSibling.id } : null;
}
