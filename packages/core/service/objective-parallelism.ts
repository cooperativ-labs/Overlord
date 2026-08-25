import { PARALLEL_BLOCKING_OBJECTIVE_STATES } from '@overlord/automations';
import type { DatabaseClient } from '@overlord/database';

import type { ServiceContext } from './context.js';

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

export type SiblingLockHolder = { objectiveId: string; missionId: string };
type HolderRow = { objective_id: string; mission_id: string };

/**
 * Objectives currently occupying their mission's sibling lock: any objective in
 * one of {@link PARALLEL_BLOCKING_OBJECTIVE_STATES}. (`launching` is in that
 * set, so an objective holding a pre-attach execution request is covered
 * without a second query against `execution_requests`.)
 *
 * This is the single definition of "that mission is busy". The direct-Run path
 * (`findConflictingActiveSibling`) and the Run Queue dispatcher both read it, so
 * the two entry points cannot disagree about whether a launch is allowed — they
 * did before, and a mission that had opted into parallel objectives was held by
 * the dispatcher while the Run button let it through.
 */
export async function findSiblingLockHolders({
  db,
  workspaceId,
  missionIds
}: {
  db: DatabaseClient;
  workspaceId: string;
  missionIds: readonly string[];
}): Promise<SiblingLockHolder[]> {
  if (missionIds.length === 0) return [];
  const missionPlaceholders = missionIds.map(() => '?').join(', ');
  const statePlaceholders = PARALLEL_BLOCKING_OBJECTIVE_STATES.map(() => '?').join(', ');
  const holders = new Map<string, SiblingLockHolder>();

  const activeObjectives = (await db.all(
    `SELECT id AS objective_id, mission_id FROM objectives
      WHERE mission_id IN (${missionPlaceholders}) AND workspace_id = ? AND deleted_at IS NULL
        AND state IN (${statePlaceholders})`,
    [...missionIds, workspaceId, ...PARALLEL_BLOCKING_OBJECTIVE_STATES]
  )) as HolderRow[];
  for (const row of activeObjectives)
    holders.set(row.objective_id, { objectiveId: row.objective_id, missionId: row.mission_id });

  return [...holders.values()];
}

/**
 * Sibling that would 409 a launch of `objectiveId`. Flag off: any objective
 * holding the mission's sibling lock other than the candidate. Flag on:
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
  const holders = await findSiblingLockHolders({
    db: ctx.db,
    workspaceId: ctx.workspace.id,
    missionIds: [missionId]
  });
  const sibling = holders.find(holder => holder.objectiveId !== objectiveId);
  return sibling ? { id: sibling.objectiveId } : null;
}
