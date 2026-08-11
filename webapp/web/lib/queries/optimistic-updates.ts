import type { MissionDetailDto, MissionDto, MyMissionsResponse, StatusType } from '../../../shared/contract.ts';
import type { QueryClient } from '@tanstack/react-query';

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

export function createReorderBoardColumnMutation(qc: QueryClient) {
  return {
    mutationFn: ({ projectId, statusId, orderedMissionIds }: ReorderBoardColumnVars) =>
      api.reorderBoardColumn(projectId, { statusId, orderedMissionIds }),
    onMutate: async (vars: ReorderBoardColumnVars) => {
      await qc.cancelQueries({ queryKey: keys.missions(vars.projectId) });
      const previous = qc.getQueryData<MissionDto[]>(keys.missions(vars.projectId));
      if (previous) {
        const positionById = new Map(
          vars.orderedMissionIds.map((id, index) => [id, (index + 1) * 100])
        );
        const next = previous
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
          .sort(byBoardOrder);
        qc.setQueryData(keys.missions(vars.projectId), next);
      }
      return { previous };
    },
    onError: (_err: unknown, vars: ReorderBoardColumnVars, context?: { previous?: MissionDto[] }) => {
      if (context?.previous) qc.setQueryData(keys.missions(vars.projectId), context.previous);
    },
    onSettled: (_data: unknown, _err: unknown, vars: ReorderBoardColumnVars) => {
      void qc.invalidateQueries({ queryKey: keys.missions(vars.projectId) });
    }
  };
}

export interface ReorderMyMissionsVars {
  statusId: string;
  statusType: StatusType;
  orderedMissionIds: string[];
}

export function createReorderMyMissionsMutation(qc: QueryClient) {
  return {
    mutationFn: ({ statusId, orderedMissionIds }: ReorderMyMissionsVars) =>
      api.reorderWorkspaceMyMissions({ statusId, orderedMissionIds }),
    onMutate: async (vars: ReorderMyMissionsVars) => {
      await qc.cancelQueries({ queryKey: keys.myMissions });
      const previous = qc.getQueryData<MyMissionsResponse>(keys.myMissions);
      if (previous) {
        const positionById = new Map(
          vars.orderedMissionIds.map((id, index) => [id, (index + 1) * 100])
        );
        qc.setQueryData<MyMissionsResponse>(keys.myMissions, {
          missions: previous.missions.map(mission => {
            const position = positionById.get(mission.id);
            return position === undefined
              ? mission
              : { ...mission, statusId: vars.statusId, statusType: vars.statusType, myPosition: position };
          })
        });
      }
      return { previous };
    },
    onError: (_err: unknown, _vars: ReorderMyMissionsVars, context?: { previous?: MyMissionsResponse }) => {
      if (context?.previous) qc.setQueryData(keys.myMissions, context.previous);
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
          ...previous.objectives.filter(objective => orderIndex.has(objective.id)).map(objective => objective.position)
        );
        qc.setQueryData(keys.mission(vars.missionId), {
          ...previous,
          objectives: previous.objectives
            .map(objective => {
              const index = orderIndex.get(objective.id);
              return index === undefined ? objective : { ...objective, position: basePosition + index };
            })
            .sort((a, b) => a.position - b.position)
        });
      }
      return { previous };
    },
    onError: (_err: unknown, vars: ReorderFutureObjectivesVars, context?: { previous?: MissionDetailDto }) => {
      if (context?.previous) qc.setQueryData(keys.mission(vars.missionId), context.previous);
    },
    onSettled: (_data: unknown, _err: unknown, vars: ReorderFutureObjectivesVars) =>
      void qc.invalidateQueries({ queryKey: keys.mission(vars.missionId) })
  };
}
