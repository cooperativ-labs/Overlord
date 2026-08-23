import { groupConcat } from '@overlord/database';

import type { ServiceContext } from './context.js';
import { resolveMissionId } from './context.js';

export type ChangedFileReview = {
  filePath: string;
  vcsStatus: string | null;
  currentDiffState: string;
  objectiveId: string;
  sessionId: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  rationaleCount: number;
  finalRationaleCount: number;
  rationaleLabels: string[];
  coverage: 'covered' | 'missing_rationale' | 'resolved';
};

export type RationaleReview = {
  id: string;
  filePath: string;
  label: string;
  summary: string;
  why: string;
  impact: string;
  objectiveId: string;
  sessionId: string | null;
  deliveryId: string | null;
  isFinal: boolean;
  createdAt: string;
};

export async function listChangedFilesForReview({
  ctx,
  missionId,
  objectiveId
}: {
  ctx: ServiceContext;
  missionId: string;
  objectiveId?: string | null;
}): Promise<ChangedFileReview[]> {
  const mission = await resolveMissionId(ctx, missionId);
  const params: string[] = [mission.id];
  const objectiveFilter = objectiveId ? 'AND cf.objective_id = ?' : '';
  if (objectiveId) params.push(objectiveId);

  const rows = (await ctx.db.all(
    `SELECT cf.file_path, cf.vcs_status, cf.current_diff_state, cf.objective_id, cf.session_id,
              cf.first_observed_at, cf.last_observed_at,
              COUNT(cr.id) AS rationale_count,
              SUM(CASE WHEN cr.is_final THEN 1 ELSE 0 END) AS final_rationale_count,
              ${groupConcat(ctx.db.dialect, 'cr.label', '\n')} AS rationale_labels
       FROM changed_files cf
       LEFT JOIN change_rationales cr
         ON cr.mission_id = cf.mission_id
        AND cr.objective_id = cf.objective_id
        AND cr.file_path = cf.file_path
        AND cr.deleted_at IS NULL
       WHERE cf.mission_id = ? AND cf.deleted_at IS NULL ${objectiveFilter}
       GROUP BY cf.id
       ORDER BY cf.file_path ASC`,
    params
  )) as Array<{
    file_path: string;
    vcs_status: string | null;
    current_diff_state: string;
    objective_id: string;
    session_id: string | null;
    first_observed_at: string;
    last_observed_at: string;
    rationale_count: number;
    final_rationale_count: number | null;
    rationale_labels: string | null;
  }>;

  const reviews = rows.map(row => {
    const rationaleCount = Number(row.rationale_count ?? 0);
    const finalRationaleCount = Number(row.final_rationale_count ?? 0);
    const coverage =
      row.current_diff_state === 'resolved'
        ? 'resolved'
        : finalRationaleCount > 0 || rationaleCount > 0
          ? 'covered'
          : 'missing_rationale';
    return {
      filePath: row.file_path,
      vcsStatus: row.vcs_status,
      currentDiffState: row.current_diff_state,
      objectiveId: row.objective_id,
      sessionId: row.session_id,
      firstObservedAt: row.first_observed_at,
      lastObservedAt: row.last_observed_at,
      rationaleCount,
      finalRationaleCount,
      rationaleLabels: row.rationale_labels?.split('\n').filter(Boolean) ?? [],
      coverage
    } satisfies ChangedFileReview;
  });

  return reviews.sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.objectiveId.localeCompare(b.objectiveId)
  );
}

export async function listRationalesForReview({
  ctx,
  missionId,
  objectiveId
}: {
  ctx: ServiceContext;
  missionId: string;
  objectiveId?: string | null;
}): Promise<RationaleReview[]> {
  const mission = await resolveMissionId(ctx, missionId);
  const params: string[] = [mission.id];
  const objectiveFilter = objectiveId ? 'AND objective_id = ?' : '';
  if (objectiveId) params.push(objectiveId);

  const rows = (await ctx.db.all(
    `SELECT id, file_path, label, summary, why, impact, objective_id, session_id,
              delivery_id, is_final, created_at
       FROM change_rationales
       WHERE mission_id = ? AND deleted_at IS NULL ${objectiveFilter}
       ORDER BY file_path ASC, created_at ASC`,
    params
  )) as Array<{
    id: string;
    file_path: string;
    label: string;
    summary: string;
    why: string;
    impact: string;
    objective_id: string;
    session_id: string | null;
    delivery_id: string | null;
    is_final: boolean | number;
    created_at: string;
  }>;

  return rows.map(row => ({
    id: row.id,
    filePath: row.file_path,
    label: row.label,
    summary: row.summary,
    why: row.why,
    impact: row.impact,
    objectiveId: row.objective_id,
    sessionId: row.session_id,
    deliveryId: row.delivery_id,
    isFinal: Boolean(row.is_final),
    createdAt: row.created_at
  }));
}
