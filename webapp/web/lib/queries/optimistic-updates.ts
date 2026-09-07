import type { QueryClient } from '@tanstack/react-query';

import type {
  MissionDetailDto,
  MissionDto,
  MyMissionsColumnType,
  MyMissionsResponse,
  StatusType
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { keys } from '../query-keys.ts';

export interface ReorderBoardColumnVars {
  projectId: string;
  statusId: string;
  statusType: StatusType;
  orderedMissionIds: string[];
}

function byBoardOrder(a: MissionDto, b: MissionDto): number {
  if (a.boardPosition !== b.boardPosition) return a.boardPosition - b.boardPosition;
  return b.sequenceNumber - a.sequenceNumber;
}

/**
 * Snapshot of every cached entry under one key prefix, and the restore that
 * undoes an optimistic patch across all of them. A board is cached once per
 * completed-mission scope (coo:941), so a drag has to patch and roll back the
 * windowed and expanded copies together — otherwise the copy the operator is
 * not looking at keeps a stale order until the settling refetch lands.
 */
type CachedEntries<T> = Array<[readonly unknown[], T | undefined]>;

function restoreCachedEntries<T>(qc: QueryClient, entries: CachedEntries<T> | undefined) {
  for (const [queryKey, data] of entries ?? []) {
    if (data !== undefined) qc.setQueryData(queryKey, data);
  }
}

export function createReorderBoardColumnMutation(qc: QueryClient) {
  return {
    mutationFn: ({ projectId, statusId, orderedMissionIds }: ReorderBoardColumnVars) =>
      api.reorderBoardColumn(projectId, { statusId, orderedMissionIds }),
    onMutate: async (vars: ReorderBoardColumnVars) => {
      await qc.cancelQueries({ queryKey: keys.missions(vars.projectId) });
      const previous = qc.getQueriesData<MissionDto[]>({
        queryKey: keys.missions(vars.projectId)
      }) as CachedEntries<MissionDto[]>;
      const positionById = new Map(
        vars.orderedMissionIds.map((id, index) => [id, (index + 1) * 100])
      );
      qc.setQueriesData<MissionDto[]>({ queryKey: keys.missions(vars.projectId) }, current =>
        current
          ? current
              .map(mission => {
                const position = positionById.get(mission.id);
                return position === undefined
                  ? mission
                  : {
                      ...mission,
                      statusId: vars.statusId,
                      statusType: vars.statusType,
                      boardPosition: position
                    };
              })
              .sort(byBoardOrder)
          : current
      );
      return { previous };
    },
    onError: (
      _err: unknown,
      _vars: ReorderBoardColumnVars,
      context?: { previous?: CachedEntries<MissionDto[]> }
    ) => {
      restoreCachedEntries(qc, context?.previous);
    },
    onSettled: (_data: unknown, _err: unknown, vars: ReorderBoardColumnVars) => {
      void qc.invalidateQueries({ queryKey: keys.missions(vars.projectId) });
    }
  };
}

export interface ReorderMyMissionsVars {
  statusType: MyMissionsColumnType;
  orderedMissionIds: string[];
}

export function createReorderMyMissionsMutation(qc: QueryClient) {
  return {
    mutationFn: ({ statusType, orderedMissionIds }: ReorderMyMissionsVars) =>
      api.reorderWorkspaceMyMissions({ statusType, orderedMissionIds }),
    onMutate: async (vars: ReorderMyMissionsVars) => {
      await qc.cancelQueries({ queryKey: keys.myMissions });
      const previous = qc.getQueriesData<MyMissionsResponse>({
        queryKey: keys.myMissions
      }) as CachedEntries<MyMissionsResponse>;
      const positionById = new Map(
        vars.orderedMissionIds.map((id, index) => [id, (index + 1) * 100])
      );
      // My Missions columns are status *types*: the concrete per-project
      // `statusId` is resolved server-side, so only the type and the personal
      // slot are predictable here. The refetch reconciles `statusId`.
      qc.setQueriesData<MyMissionsResponse>({ queryKey: keys.myMissions }, current =>
        current
          ? {
              ...current,
              missions: current.missions.map(mission => {
                const position = positionById.get(mission.id);
                return position === undefined
                  ? mission
                  : { ...mission, statusType: vars.statusType, myPosition: position };
              })
            }
          : current
      );
      return { previous };
    },
    onError: (
      _err: unknown,
      _vars: ReorderMyMissionsVars,
      context?: { previous?: CachedEntries<MyMissionsResponse> }
    ) => {
      restoreCachedEntries(qc, context?.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.myMissions })
  };
}

export interface ReorderFutureObjectivesVars {
  missionId: string;
  orderedObjectiveIds: string[];
}

export function createReorderFutureObjectivesMutation(qc: QueryClient) {
  return {
    mutationFn: ({ missionId, orderedObjectiveIds }: ReorderFutureObjectivesVars) =>
      api.reorderFutureObjectives(missionId, { orderedObjectiveIds }),
    onMutate: async (vars: ReorderFutureObjectivesVars) => {
      await qc.cancelQueries({ queryKey: keys.mission(vars.missionId) });
      const previous = qc.getQueryData<MissionDetailDto>(keys.mission(vars.missionId));
      if (previous) {
        const orderIndex = new Map(vars.orderedObjectiveIds.map((id, index) => [id, index]));
        const basePosition = Math.min(
          ...previous.objectives
            .filter(objective => orderIndex.has(objective.id))
            .map(objective => objective.position)
        );
        qc.setQueryData(keys.mission(vars.missionId), {
          ...previous,
          objectives: previous.objectives
            .map(objective => {
              const index = orderIndex.get(objective.id);
              return index === undefined
                ? objective
                : { ...objective, position: basePosition + index };
            })
            .sort((a, b) => a.position - b.position)
        });
      }
      return { previous };
    },
    onError: (
      _err: unknown,
      vars: ReorderFutureObjectivesVars,
      context?: { previous?: MissionDetailDto }
    ) => {
      if (context?.previous) qc.setQueryData(keys.mission(vars.missionId), context.previous);
    },
    onSettled: (_data: unknown, _err: unknown, vars: ReorderFutureObjectivesVars) =>
      void qc.invalidateQueries({ queryKey: keys.mission(vars.missionId) })
  };
}
