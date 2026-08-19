import type { MissionDto, ProjectStatusDto, StatusType } from '../../shared/contract.ts';

import type { ColumnMap } from './board-shared.ts';

/**
 * One column on the aggregate My Missions board, formed by deduplicating the
 * per-project status lists by lowercase name (Q5 v1). Cards from different
 * projects whose statuses share a name appear in the same column, but each
 * contributing project keeps its own concrete `project_statuses.id` so a
 * reorder/status-change can still be persisted per project.
 */
export interface MergedStatusColumn {
  /** Stable key: the lowercase, trimmed status name. Also the DnD droppable id. */
  key: string;
  /** Representative display name (the first-seen project's casing). */
  name: string;
  type: StatusType;
  /** `project_statuses.id` per project that owns a status with this name. */
  statusIdByProject: Map<string, string>;
}

export interface MergedColumns {
  /** Columns in display order (first-seen precedence across `orderedProjectIds`). */
  columns: MergedStatusColumn[];
  byKey: Map<string, MergedStatusColumn>;
  /** Maps every contributing status id to its merged column key. */
  keyByStatusId: Map<string, string>;
}

/** Normalize a status name to the key used to merge like-named columns. */
export function normalizeStatusKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Merge the per-project status lists of a multi-project board into one set of
 * columns, deduplicated by lowercase name. `orderedProjectIds` sets the
 * first-seen precedence: the earliest project to contribute a given name owns
 * the column's display casing and position; later projects only attach their
 * own status id for that name. Statuses are read in position order within each
 * project so the first project's ordering drives the column layout.
 */
export function buildMergedStatusColumns(
  orderedProjectIds: string[],
  statusesByProject: Map<string, ProjectStatusDto[]>
): MergedColumns {
  const byKey = new Map<string, MergedStatusColumn>();
  const keyByStatusId = new Map<string, string>();
  const columns: MergedStatusColumn[] = [];

  for (const projectId of orderedProjectIds) {
    const statuses = [...(statusesByProject.get(projectId) ?? [])].sort(
      (a, b) => a.position - b.position
    );
    for (const status of statuses) {
      const key = normalizeStatusKey(status.name);
      keyByStatusId.set(status.id, key);
      let column = byKey.get(key);
      if (!column) {
        column = { key, name: status.name, type: status.type, statusIdByProject: new Map() };
        byKey.set(key, column);
        columns.push(column);
      }
      // First status wins per project when a project has case-variant duplicates.
      if (!column.statusIdByProject.has(projectId)) {
        column.statusIdByProject.set(projectId, status.id);
      }
    }
  }

  return { columns, byKey, keyByStatusId };
}

/**
 * Bucket missions into merged columns by their status's lowercase name. Server
 * order is preserved within each bucket. Missions whose status isn't represented
 * in `keyByStatusId` (deleted status, or a project whose statuses weren't
 * loaded) fall into the uncategorized bucket.
 */
export function groupMissionsByMergedColumn<T extends MissionDto>(
  missions: T[],
  keyByStatusId: Map<string, string>
): { columns: ColumnMap; uncategorized: string[] } {
  const columns: ColumnMap = {};
  const uncategorized: string[] = [];
  for (const mission of missions) {
    const key = keyByStatusId.get(mission.statusId);
    if (key) (columns[key] ??= []).push(mission.id);
    else uncategorized.push(mission.id);
  }
  return { columns, uncategorized };
}

/**
 * Resolve a drop of one mission into a merged column. Returns the concrete
 * project status to move to and the subset of the merged column's new order
 * that belongs to the mission's project — the My Missions reorder endpoint is
 * project-scoped, so a merged column that interleaves projects persists one
 * project's slice at a time. Returns `null` when the mission's project has no
 * status with this column's name, which the caller surfaces as the "status
 * doesn't exist in this project" error (drag requirement 3).
 */
export function resolveMergedColumnReorder<T extends MissionDto>(
  column: MergedStatusColumn,
  mission: T,
  mergedOrderedMissionIds: string[],
  missionById: Map<string, T>
): { statusId: string; orderedMissionIds: string[] } | null {
  const statusId = column.statusIdByProject.get(mission.projectId);
  if (!statusId) return null;
  const orderedMissionIds = mergedOrderedMissionIds.filter(
    id => missionById.get(id)?.projectId === mission.projectId
  );
  return { statusId, orderedMissionIds };
}
