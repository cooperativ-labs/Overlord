import { useState } from 'react';

import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';

import { firstObjectiveCreatePayload } from '../lib/project-resources.ts';
import { useCreateMission, useMission } from '../lib/queries/missions.ts';
import { useCreateObjective } from '../lib/queries/objectives.ts';

/**
 * Promote one deferred-work item from a delivery: into a new mission in the
 * same project (bound to the delivering objective's resource), or onto the
 * delivering mission as a future objective.
 */
export function DeferredWorkActions({
  item,
  missionId,
  objectiveId
}: {
  item: string;
  missionId: string;
  objectiveId: string;
}) {
  // Already cached wherever a delivery card renders inside a mission panel.
  const missionQ = useMission(missionId);
  const createMission = useCreateMission();
  const createObjective = useCreateObjective();
  const [missionState, setMissionState] = useState<ButtonLoadingState>('default');
  const [objectiveState, setObjectiveState] = useState<ButtonLoadingState>('default');
  const [createdDisplayId, setCreatedDisplayId] = useState<string | null>(null);

  const mission = missionQ.data;
  const resourceKey =
    mission?.objectives.find(objective => objective.id === objectiveId)?.resourceKey ?? null;
  const instructionText = item.trim();

  async function handleCreateMission() {
    if (!mission) return;
    setMissionState('loading');
    try {
      const created = await createMission.mutateAsync({
        projectId: mission.projectId,
        ...firstObjectiveCreatePayload(instructionText, resourceKey)
      });
      setCreatedDisplayId(created.displayId);
      setMissionState('success');
    } catch {
      setMissionState('error');
    }
  }

  async function handleAddObjective() {
    setObjectiveState('loading');
    try {
      await createObjective.mutateAsync({
        missionId,
        instructionText,
        state: 'future',
        resourceKey
      });
      setObjectiveState('success');
    } catch {
      setObjectiveState('error');
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <LoadingButton
        type="button"
        variant="outline"
        size="xs"
        buttonState={missionState}
        setButtonState={setMissionState}
        disabled={!mission || missionState === 'success'}
        text="Create mission"
        loadingText="Creating…"
        successText={createdDisplayId ? `Created ${createdDisplayId}` : 'Mission created'}
        errorText="Failed — retry"
        onClick={handleCreateMission}
      />
      <LoadingButton
        type="button"
        variant="outline"
        size="xs"
        buttonState={objectiveState}
        setButtonState={setObjectiveState}
        disabled={!mission || objectiveState === 'success'}
        text="Add Objective"
        loadingText="Adding…"
        successText="Objective added"
        errorText="Failed — retry"
        onClick={handleAddObjective}
      />
    </div>
  );
}
