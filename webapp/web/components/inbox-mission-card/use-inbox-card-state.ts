import { useEffect, useMemo, useState } from 'react';

import {
  type AgentModelSelection,
  MANUAL_AGENT_KEY
} from '@/components/objectives/AgentModelSelector.tsx';
import {
  executionTargetAvailability,
  objectiveResourceConnection
} from '@/lib/project-resources.ts';
import {
  useAccessibleWorkspaces,
  useAgentCatalog,
  useAllProjects,
  useLaunchPreference,
  useLaunchSettings,
  useProjectExecutionTarget,
  useProjectResources,
  useUpdateLaunchPreference
} from '@/lib/queries.ts';

import type {
  AgentCatalogDto,
  AgentLaunchConfigDto,
  LaunchPreferenceDto
} from '../../../shared/contract.ts';

const EMPTY_LAUNCH_CONFIGS: Record<string, AgentLaunchConfigDto> = {};

type AssignedSelection = {
  agent: string | null | undefined;
  model: string | null | undefined;
  reasoningEffort: string | null | undefined;
};

export type InboxCardReadiness = {
  canSubmit: boolean;
  canRun: boolean;
  isManual: boolean;
};

export function getInboxCardDefaultSelection({
  assignedSelection,
  preference,
  catalog
}: {
  assignedSelection?: AssignedSelection | null;
  preference?: LaunchPreferenceDto | null;
  catalog?: AgentCatalogDto | null;
}): AgentModelSelection {
  if (assignedSelection?.agent) {
    return {
      agent: assignedSelection.agent,
      model: assignedSelection.model ?? null,
      reasoningEffort: assignedSelection.reasoningEffort ?? null
    };
  }
  if (preference?.selectedAgent) {
    return {
      agent: preference.selectedAgent,
      model: preference.selectedModel,
      reasoningEffort: preference.selectedReasoningEffort
    };
  }
  return {
    agent: catalog?.defaultAgent ?? 'claude',
    model: catalog?.defaultModel ?? null,
    reasoningEffort: null
  };
}

export function getInboxCardReadiness({
  instruction,
  hasProject,
  selectionLoaded,
  isBusy,
  isActionable,
  selection,
  primaryConnected,
  targetAvailable
}: {
  instruction: string;
  hasProject: boolean;
  selectionLoaded: boolean;
  isBusy: boolean;
  isActionable: boolean;
  selection: AgentModelSelection;
  primaryConnected: boolean;
  targetAvailable: boolean;
}): InboxCardReadiness {
  const canSubmit =
    Boolean(instruction.trim()) && (!hasProject || selectionLoaded) && !isBusy && isActionable;
  const isManual = selection.agent === MANUAL_AGENT_KEY;
  return {
    canSubmit,
    canRun: hasProject && canSubmit && !isManual && primaryConnected && targetAvailable,
    isManual
  };
}

export function useInboxCardState({
  projectId,
  workspaceId,
  resourceKey,
  instruction,
  isBusy,
  isActionable = true,
  assignedSelection = null,
  launchConfigOverrides
}: {
  projectId: string;
  workspaceId: string | null | undefined;
  resourceKey: string | null;
  instruction: string;
  isBusy: boolean;
  isActionable?: boolean;
  assignedSelection?: AssignedSelection | null;
  launchConfigOverrides?: Record<string, AgentLaunchConfigDto>;
}) {
  const projectsQ = useAllProjects();
  const projects = useMemo(
    () => projectsQ.data.filter(project => project.status === 'active'),
    [projectsQ.data]
  );
  const workspaces = useAccessibleWorkspaces();
  const selectedProject = projects.find(project => project.id === projectId) ?? null;
  const catalogQ = useAgentCatalog(selectedProject?.workspaceId ?? workspaceId);
  const preferenceQ = useLaunchPreference(projectId);
  const resourcesQ = useProjectResources(projectId);
  const executionTargetQ = useProjectExecutionTarget(projectId);
  const updatePreference = useUpdateLaunchPreference(projectId);
  const settingsQ = useLaunchSettings();

  const projectGroups = useMemo(
    () =>
      workspaces
        .map(workspace => ({
          workspace,
          projects: projects.filter(project => project.workspaceId === workspace.id)
        }))
        .filter(group => group.projects.length > 0),
    [projects, workspaces]
  );
  const catalog = catalogQ.data ?? null;
  const selectionLoaded = Boolean(catalog) && !preferenceQ.isLoading && !settingsQ.isLoading;
  const effectiveIsBusy = isBusy || !isActionable;
  const defaultSelection = useMemo(
    () =>
      getInboxCardDefaultSelection({
        assignedSelection,
        preference: preferenceQ.data,
        catalog
      }),
    [assignedSelection, catalog, preferenceQ.data]
  );
  const initialLaunchConfigs = launchConfigOverrides ?? EMPTY_LAUNCH_CONFIGS;
  const [selection, setSelection] = useState<AgentModelSelection>(defaultSelection);
  const [explicitLaunchConfigs, setExplicitLaunchConfigs] = useState(initialLaunchConfigs);

  useEffect(() => {
    setSelection(defaultSelection);
    setExplicitLaunchConfigs(initialLaunchConfigs);
  }, [defaultSelection, initialLaunchConfigs]);

  const primaryConnection = objectiveResourceConnection({
    resources: resourcesQ.data ?? [],
    resourceKey,
    executionTargetId: executionTargetQ.data?.selectedExecutionTargetId ?? null
  });
  const targetAvailability = executionTargetAvailability({
    primaryConnected: primaryConnection.connected,
    eligibleTargets: executionTargetQ.data?.eligibleTargets
  });
  const readiness = getInboxCardReadiness({
    instruction,
    hasProject: Boolean(projectId),
    selectionLoaded,
    isBusy: effectiveIsBusy,
    isActionable,
    selection,
    primaryConnected: primaryConnection.connected,
    targetAvailable: targetAvailability.available
  });

  const persistSelectionPreference = (next: AgentModelSelection) => {
    if (!projectId) return;
    updatePreference.mutate({
      selectedAgent: next.agent,
      selectedModel: next.model,
      selectedReasoningEffort: next.reasoningEffort
    });
  };

  const handleSelectionChange = (next: AgentModelSelection) => {
    setSelection(next);
    persistSelectionPreference(next);
  };

  return {
    projects,
    projectGroups,
    showWorkspaceGroups: projectGroups.length > 1,
    selectedProject,
    catalog,
    agentConfigs: {
      ...(settingsQ.data?.agentConfigs ?? {}),
      ...initialLaunchConfigs
    },
    resources: resourcesQ.data ?? [],
    selectionLoaded,
    primaryConnection,
    targetAvailability,
    selection,
    explicitLaunchConfigs,
    setExplicitLaunchConfigs,
    handleSelectionChange,
    persistSelectionPreference,
    isBusy: effectiveIsBusy,
    ...readiness
  };
}
