import type { AgentModelSelection } from '@/components/objectives/AgentModelSelector.tsx';
import type {
  executionTargetAvailability,
  objectiveResourceConnection
} from '@/lib/project-resources.ts';

import type {
  AgentLaunchConfigDto,
  LaunchObjectiveBody,
  MissionDetailDto,
  UpdateInboxItemBody,
  UpdateObjectiveBody
} from '../../../shared/contract.ts';

export type InboxCardPendingAction = 'save' | 'run' | 'delete';

/** Readiness facts a Run must satisfy before any mutation is attempted. */
export type InboxCardLaunchGate = {
  isManual: boolean;
  primaryConnection: ReturnType<typeof objectiveResourceConnection>;
  targetAvailability: ReturnType<typeof executionTargetAvailability>;
};

type InboxCardAgentChoice = {
  selection: AgentModelSelection;
  explicitLaunchConfigs: Record<string, AgentLaunchConfigDto>;
};

/** Mutation functions an inbox card needs; hooks pass TanStack `mutateAsync`s. */
export type InboxCardMutations = {
  updateInbox: (variables: { id: string; body: UpdateInboxItemBody }) => Promise<unknown>;
  promote: (variables: { id: string; projectId: string }) => Promise<MissionDetailDto>;
  updateObjective: (variables: { id: string; body: UpdateObjectiveBody }) => Promise<unknown>;
  launchObjective: (variables: { id: string; body: LaunchObjectiveBody }) => Promise<unknown>;
  persistSelectionPreference: (selection: AgentModelSelection) => void;
};

export function assertInboxCardCanLaunch({
  isManual,
  primaryConnection,
  targetAvailability
}: InboxCardLaunchGate) {
  if (isManual) {
    throw new Error('Please select an agent to launch this task');
  }
  if (!primaryConnection.connected) {
    throw new Error(primaryConnection.message ?? 'Primary resource is not connected.');
  }
  if (!targetAvailability.available) {
    throw new Error(targetAvailability.message ?? 'No execution target is available.');
  }
}

/** Inbox rows store the first line as the title and the full text as the objective. */
export function inboxItemTextBody(text: string): UpdateInboxItemBody {
  const title = text.split('\n')[0]?.trim() || text;
  return { title, objectives: [text] };
}

function launchBody({
  selection,
  explicitLaunchConfigs
}: InboxCardAgentChoice): LaunchObjectiveBody {
  return {
    agent: selection.agent,
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    launchConfigOverride: explicitLaunchConfigs[selection.agent]
  };
}

function launchConfigOverrideBody({ selection, explicitLaunchConfigs }: InboxCardAgentChoice) {
  return explicitLaunchConfigs[selection.agent]
    ? {
        launchConfigAgent: selection.agent,
        launchConfigOverride: explicitLaunchConfigs[selection.agent]
      }
    : {};
}

/**
 * Saves or runs an unassigned Inbox capture. Without a project the text is saved
 * in place and `null` is returned; with a project the row is promoted (after
 * persisting edits so the mission inherits them) and the new mission is returned.
 */
export async function submitUnassignedInboxItem(
  {
    itemId,
    text,
    projectId,
    resourceKey,
    shouldLaunch,
    gate,
    ...choice
  }: InboxCardAgentChoice & {
    itemId: string;
    text: string;
    projectId: string;
    resourceKey: string | null;
    shouldLaunch: boolean;
    gate: InboxCardLaunchGate;
  },
  mutations: InboxCardMutations
): Promise<MissionDetailDto | null> {
  if (!projectId) {
    await mutations.updateInbox({ id: itemId, body: inboxItemTextBody(text) });
    return null;
  }

  if (shouldLaunch) assertInboxCardCanLaunch(gate);

  // Keep the inbox row current before promote so the mission inherits edits.
  await mutations.updateInbox({ id: itemId, body: inboxItemTextBody(text) });
  const mission = await mutations.promote({ id: itemId, projectId });
  const objective = mission.objectives[0];
  if (!objective) {
    throw new Error('Mission was created without an objective.');
  }

  if (resourceKey) {
    await mutations.updateObjective({ id: objective.id, body: { resourceKey } });
  }

  if (shouldLaunch) {
    await mutations.launchObjective({ id: objective.id, body: launchBody(choice) });
  } else {
    await mutations.updateObjective({
      id: objective.id,
      body: {
        assignedAgent: choice.selection.agent,
        model: choice.selection.model,
        reasoningEffort: choice.selection.reasoningEffort,
        ...launchConfigOverrideBody(choice)
      }
    });
    mutations.persistSelectionPreference(choice.selection);
  }

  return mission;
}

/**
 * Saves or runs the objective behind a promoted Inbox card. A save also records
 * the agent choice on the objective; a run leaves assignment to the launch.
 */
export async function submitPromotedInboxObjective(
  {
    objectiveId,
    text,
    resourceKey,
    shouldLaunch,
    gate,
    ...choice
  }: InboxCardAgentChoice & {
    objectiveId: string;
    text: string;
    resourceKey: string | null;
    shouldLaunch: boolean;
    gate: InboxCardLaunchGate;
  },
  mutations: Pick<
    InboxCardMutations,
    'updateObjective' | 'launchObjective' | 'persistSelectionPreference'
  >
) {
  if (shouldLaunch) assertInboxCardCanLaunch(gate);

  await mutations.updateObjective({
    id: objectiveId,
    body: {
      instructionText: text,
      resourceKey,
      ...(shouldLaunch
        ? {}
        : {
            assignedAgent: choice.selection.agent,
            model: choice.selection.model,
            reasoningEffort: choice.selection.reasoningEffort
          }),
      ...launchConfigOverrideBody(choice)
    }
  });

  if (shouldLaunch) {
    await mutations.launchObjective({ id: objectiveId, body: launchBody(choice) });
  } else {
    mutations.persistSelectionPreference(choice.selection);
  }
}
