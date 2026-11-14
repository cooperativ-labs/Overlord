import { siblingBlocksParallelLaunch } from '@overlord/automations/objective-manager';
import type { ExecutionRequestDto, ObjectiveDto, ObjectiveState } from '@overlord/contract';

import { useProjectResources, useUpdateObjective } from '../../lib/queries.ts';

import { AgentLaunchButton } from './AgentLaunchButton.tsx';
import { AgentModelChooserButton } from './AgentModelChooserButton.tsx';
import { DraftObjectiveActions } from './DraftObjectiveActions.tsx';
import { ObjectiveResourcePicker } from './ObjectiveResourcePicker.tsx';
import { useObjectiveAgentSelection } from './useObjectiveAgentSelection.ts';

const ACTIVE_SIBLING_STATES: ObjectiveState[] = ['launching', 'executing', 'pending_delivery'];
const ACTIVE_EXECUTION_REQUEST_STATES: ExecutionRequestDto['status'][] = [
  'queued',
  'claimed',
  'launching'
];

type DraftObjectiveToolbarProps = {
  objective: ObjectiveDto;
  /** All objectives on the mission — used to detect an already-active sibling. */
  siblings: ObjectiveDto[];
  /** Active execution requests for the mission (from MissionDetailDto). */
  executionRequests: ExecutionRequestDto[];
  /** Mission-level opt-in for cross-resource parallel execution. */
  allowParallelObjectives?: boolean;
};

export function DraftObjectiveToolbar({
  objective,
  siblings,
  executionRequests,
  allowParallelObjectives = false
}: DraftObjectiveToolbarProps) {
  const update = useUpdateObjective();
  const resourcesQ = useProjectResources(objective.projectId);
  const {
    catalog,
    agentConfigs,
    selection,
    setSelection,
    commitLaunchConfig,
    useInheritedLaunchConfig,
    launchConfigSourceHint,
    loaded
  } = useObjectiveAgentSelection(objective);

  const isLaunching = objective.state === 'launching';
  const isSubmitted = objective.state === 'submitted';
  const isLaunchable = objective.state === 'draft' || isSubmitted || isLaunching;
  const primaryResourceKey =
    resourcesQ.data?.find(resource => resource.isPrimary)?.resourceKey ?? 'primary';
  const activeSiblingObjective =
    siblings.find(o => o.id !== objective.id && ACTIVE_SIBLING_STATES.includes(o.state)) ?? null;
  const activeSiblingRequest =
    executionRequests.find(request => {
      if (request.objectiveId === objective.id) return false;
      if (!ACTIVE_EXECUTION_REQUEST_STATES.includes(request.status)) return false;
      const requestObjective = siblings.find(o => o.id === request.objectiveId);
      return Boolean(requestObjective && ACTIVE_SIBLING_STATES.includes(requestObjective.state));
    }) ?? null;
  const resolvedActiveSibling =
    activeSiblingObjective ??
    siblings.find(o => o.id === activeSiblingRequest?.objectiveId) ??
    null;
  const hasBlockingSibling = Boolean(
    resolvedActiveSibling &&
    siblingBlocksParallelLaunch({
      allowParallelObjectives,
      candidateResourceKey: objective.resourceKey,
      siblingResourceKey: resolvedActiveSibling.resourceKey,
      primaryResourceKey
    })
  );
  const activeSiblingId = resolvedActiveSibling?.id ?? null;
  const activeRequest = executionRequests.find(r => r.objectiveId === objective.id) ?? null;

  return (
    <div className="flex shrink-0 flex-nowrap items-center gap-2">
      {objective.displayId ? (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {objective.displayId}
        </span>
      ) : null}
      <DraftObjectiveActions objective={objective} />

      <ObjectiveResourcePicker
        resources={resourcesQ.data ?? []}
        value={objective.resourceKey}
        disabled={update.isPending}
        onChange={resourceKey => update.mutate({ id: objective.id, body: { resourceKey } })}
      />

      <AgentModelChooserButton
        catalog={catalog}
        selection={selection}
        onChange={setSelection}
        agentConfigs={agentConfigs}
        onLaunchConfigCommit={commitLaunchConfig}
        onUseInheritedDefault={useInheritedLaunchConfig}
        launchConfigSourceHint={launchConfigSourceHint}
      />

      {/* Every draft, submitted or launching objective launches directly —
          wherever it sits in the queue; there is no promote step. */}
      {isLaunchable ? (
        <AgentLaunchButton
          objective={objective}
          selection={selection}
          selectionLoaded={loaded}
          hasActiveSibling={hasBlockingSibling}
          activeSiblingId={activeSiblingId}
          activeRequest={activeRequest}
          size="sm"
        />
      ) : null}
    </div>
  );
}
