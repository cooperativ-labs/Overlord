import {
  type MissionDto,
  MY_MISSIONS_COLUMNS,
  type MyMissionsColumnType,
  type ProjectStatusDto
} from '../../shared/contract.ts';

import type { ColumnMap } from './board-shared.ts';

/**
 * One column on the aggregate My Missions board. My Missions aggregates across
 * every project of every workspace in the active organization, where status
 * *names* are project-defined and inconsistent — so the board is keyed on
 * `StatusType`, the one status vocabulary every project shares.
 */
export interface MyMissionsColumn {
  /** Stable key and DnD droppable id: the status type itself. */
  key: MyMissionsColumnType;
  type: MyMissionsColumnType;
  /** Display name of the column. */
  name: string;
}

/** The four fixed columns, in display order. */
export const MY_MISSIONS_BOARD_COLUMNS: MyMissionsColumn[] = MY_MISSIONS_COLUMNS.map(column => ({
  key: column.type,
  type: column.type,
  name: column.label
}));

const COLUMN_TYPES = new Set<string>(MY_MISSIONS_BOARD_COLUMNS.map(column => column.type));

/** Whether a mission's status type is one this board renders. */
export function isMyMissionsColumnKey(value: string): value is MyMissionsColumnType {
  return COLUMN_TYPES.has(value);
}

/**
 * Personal slot on My Missions (`MyMissionDto.myPosition`). Other mission
 * shapes omit it; treat those as unpositioned so they sort after dragged cards.
 */
function personalColumnPosition(mission: MissionDto): number | null {
  const value = (mission as { myPosition?: number | null }).myPosition;
  return typeof value === 'number' ? value : null;
}

/**
 * Bucket missions into the four status-type columns, preserving the server's
 * within-column order (personal position first, then the default fallback).
 * Missions whose status type is outside the board vocabulary (`draft`,
 * `blocked`, `cancelled`) are not placed in any column.
 */
export function groupMissionsByStatusType<T extends MissionDto>(missions: T[]): ColumnMap {
  const columns: ColumnMap = {};
  for (const column of MY_MISSIONS_BOARD_COLUMNS) columns[column.key] = [];
  const indexed = missions.map((mission, index) => ({ mission, index }));
  indexed.sort((left, right) => {
    const leftPos = personalColumnPosition(left.mission);
    const rightPos = personalColumnPosition(right.mission);
    const leftMissing = leftPos === null;
    const rightMissing = rightPos === null;
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    if (leftPos !== null && rightPos !== null && leftPos !== rightPos) return leftPos - rightPos;
    return left.index - right.index;
  });
  for (const { mission } of indexed) {
    const bucket = columns[mission.statusType];
    if (bucket) bucket.push(mission.id);
  }
  return columns;
}

/**
 * Resolve the concrete `project_statuses.id` a mission should land on for a
 * given board column, inside that mission's *own* project: the lowest-position
 * active status of the column's type. A mission already sitting in a status of
 * that type keeps its current status, so a project's custom column naming is
 * preserved. Mirrors the server-side resolution in the reorder endpoint so
 * mission creation from a column lands where the drag would.
 *
 * Returns `null` when the project defines no status of this type.
 */
export function resolveProjectStatusForColumn(
  statuses: ProjectStatusDto[],
  type: MyMissionsColumnType
): string | null {
  const match = statuses
    .filter(status => status.type === type)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0];
  return match?.id ?? null;
}

/**
 * Projects among the moved missions that cannot accept this column, i.e. define
 * no status of its type. A drop is rejected outright when any is present, so a
 * partially-applied cross-project move is never persisted.
 */
export function projectsMissingColumnType<T extends MissionDto>(
  missions: T[],
  type: MyMissionsColumnType,
  statusesByProject: Map<string, ProjectStatusDto[]>
): string[] {
  const missing = new Set<string>();
  for (const mission of missions) {
    if (mission.statusType === type) continue;
    const statuses = statusesByProject.get(mission.projectId);
    // An unloaded project is not evidence of a missing status; let the server decide.
    if (statuses && !resolveProjectStatusForColumn(statuses, type)) missing.add(mission.projectId);
  }
  return [...missing];
}
