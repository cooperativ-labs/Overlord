import type { HumanActionCategory, HumanActionItemDto } from '../../../shared/contract.ts';

/** One objective's actions under a mission in the rail. */
export interface HumanActionObjectiveGroup {
  objectiveId: string;
  objectiveDisplayId: string;
  objectiveTitle: string | null;
  deliveredAt: string;
  agentIdentifier: string | null;
  items: HumanActionItemDto[];
}

/** One mission in the rail, with its objectives in newest-delivery-first order. */
export interface HumanActionMissionGroup {
  missionId: string;
  missionDisplayId: string;
  missionTitle: string;
  projectId: string;
  projectName: string;
  projectColor: string | null;
  /** Any open action in the mission is blocking. */
  blocking: boolean;
  /** The newest delivery among the mission's objectives, for ordering. */
  deliveredAt: string;
  openCount: number;
  objectives: HumanActionObjectiveGroup[];
}

/**
 * Group a flat, server-ordered action list by mission and objective so the rail
 * reads as "this mission needs these things". Order is preserved from the server
 * (open first, blocking first, newest first) at every level, so a mission with
 * a blocking action rises to the top without re-sorting on the client.
 */
export function groupHumanActions(items: HumanActionItemDto[]): HumanActionMissionGroup[] {
  const missions = new Map<string, HumanActionMissionGroup>();
  for (const item of items) {
    let mission = missions.get(item.missionId);
    if (!mission) {
      mission = {
        missionId: item.missionId,
        missionDisplayId: item.missionDisplayId,
        missionTitle: item.missionTitle,
        projectId: item.projectId,
        projectName: item.projectName,
        projectColor: item.projectColor,
        blocking: false,
        deliveredAt: item.deliveredAt,
        openCount: 0,
        objectives: []
      };
      missions.set(item.missionId, mission);
    }
    let objective = mission.objectives.find(group => group.objectiveId === item.objectiveId);
    if (!objective) {
      objective = {
        objectiveId: item.objectiveId,
        objectiveDisplayId: item.objectiveDisplayId,
        objectiveTitle: item.objectiveTitle,
        deliveredAt: item.deliveredAt,
        agentIdentifier: item.agentIdentifier,
        items: []
      };
      mission.objectives.push(objective);
    }
    objective.items.push(item);
    if (item.resolution === null) {
      mission.openCount += 1;
      if (item.blocking) mission.blocking = true;
    }
    if (item.deliveredAt > mission.deliveredAt) mission.deliveredAt = item.deliveredAt;
  }
  return [...missions.values()];
}

export const HUMAN_ACTION_CATEGORY_LABELS: Record<HumanActionCategory, string> = {
  environment: 'Environment',
  database: 'Database',
  deployment: 'Deployment',
  codegen: 'Codegen',
  packaging: 'Packaging',
  external_service: 'External service',
  other: 'Other'
};

export function humanActionCategoryLabel(category: string): string {
  return (HUMAN_ACTION_CATEGORY_LABELS as Record<string, string>)[category] ?? 'Other';
}
