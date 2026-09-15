import { useEffect, useState } from 'react';

import {
  useLaunchObjective,
  useMission,
  useUpdateMission,
  useUpdateObjective
} from '@/lib/queries.ts';

import type { MissionDetailDto } from '../../../shared/contract.ts';

import { submitPromotedInboxObjective } from './inbox-card-actions.ts';
import { inboxCardShellStateProps, useInboxCardState } from './use-inbox-card-state.ts';

/**
 * Form state and mutation wiring for an Inbox card whose capture has already
 * been promoted to a mission. The live mission query keeps the card current.
 */
export function usePromotedInboxCard(initialMission: MissionDetailDto) {
  const missionQ = useMission(initialMission.id);
  const mission = missionQ.data ?? initialMission;
  const objective = mission.objectives[0] ?? null;

  const launchObjective = useLaunchObjective();
  const updateObjective = useUpdateObjective();
  const updateMission = useUpdateMission(mission.id);

  const [instruction, setInstruction] = useState(objective?.instructionText ?? mission.title);
  const [resourceKey, setResourceKey] = useState<string | null>(objective?.resourceKey ?? null);
  const [pendingAction, setPendingAction] = useState<'save' | 'run' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!objective) return;
    setInstruction(objective.instructionText);
    setResourceKey(objective.resourceKey);
  }, [objective?.id, objective?.instructionText, objective?.resourceKey, objective]);

  const state = useInboxCardState({
    projectId: mission.projectId,
    workspaceId: mission.workspaceId,
    resourceKey,
    instruction,
    isBusy: pendingAction !== null,
    isActionable: Boolean(objective),
    assignedSelection: objective
      ? {
          agent: objective.assignedAgent,
          model: objective.model,
          reasoningEffort: objective.reasoningEffort
        }
      : null,
    launchConfigOverrides: objective?.launchConfigOverrides?.['*']
  });

  async function submit(shouldLaunch: boolean) {
    const text = instruction.trim();
    if (!text || !objective || !state.selectionLoaded || state.isBusy) return;

    setPendingAction(shouldLaunch ? 'run' : 'save');
    setSubmitError(null);

    try {
      await submitPromotedInboxObjective(
        {
          objectiveId: objective.id,
          text,
          resourceKey,
          shouldLaunch,
          gate: state,
          selection: state.selection,
          explicitLaunchConfigs: state.explicitLaunchConfigs
        },
        {
          updateObjective: updateObjective.mutateAsync,
          launchObjective: launchObjective.mutateAsync,
          persistSelectionPreference: state.persistSelectionPreference
        }
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to update mission.');
    } finally {
      setPendingAction(null);
    }
  }

  return {
    mission,
    shellProps: {
      ...inboxCardShellStateProps(state),
      instruction,
      onInstructionChange: setInstruction,
      projectId: mission.projectId,
      resourceKey,
      onSelectProject: () => {
        /* Project is locked after promotion; open the mission panel to move it. */
      },
      onSelectInbox: () => {
        /* Cannot return a promoted mission to Inbox from this card. */
      },
      onResourceChange: setResourceKey,
      dueDatetime: mission.dueDatetime,
      onDueDatetimeChange: async (next: string | null) => {
        await updateMission.mutateAsync({ dueDatetime: next });
      },
      pendingAction,
      submitError,
      onSave: () => void submit(false),
      onRun: () => void submit(true)
    }
  };
}
