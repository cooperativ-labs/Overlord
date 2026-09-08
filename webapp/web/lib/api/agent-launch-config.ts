import type {
  AgentCatalogDto,
  ExecutionRequestDto,
  LaunchObjectiveBody,
  LaunchPreferenceDto,
  LaunchSettingsDto,
  ObjectiveEffectiveLaunchConfigDto,
  ObjectiveLaunchCommandDto,
  ProjectExecutionTargetDto,
  UpdateAgentCatalogBody,
  UpdateAgentLaunchConfigBody,
  UpdateLaunchPreferenceBody,
  UpdateLaunchSessionDefaultsBody,
  UpdateProjectExecutionTargetBody,
  UpdateTerminalProfileBody
} from '../../../shared/contract.ts';

import { request } from './request.ts';

export const agentLaunchConfigApi = {
  launchObjective: (id: string, body: LaunchObjectiveBody) =>
    request<ExecutionRequestDto>('POST', `/api/objectives/${id}/launch`, body),
  getObjectiveLaunchCommand: ({
    id,
    agent,
    model,
    reasoningEffort,
    executionTargetId
  }: {
    id: string;
    agent: string;
    model?: string | null;
    reasoningEffort?: string | null;
    executionTargetId?: string | null;
  }) => {
    const params = new URLSearchParams({ agent });
    if (model) params.set('model', model);
    if (reasoningEffort) params.set('reasoningEffort', reasoningEffort);
    if (executionTargetId) params.set('executionTargetId', executionTargetId);
    return request<ObjectiveLaunchCommandDto>(
      'GET',
      `/api/objectives/${id}/launch-command?${params.toString()}`
    );
  },
  getObjectiveEffectiveLaunchConfig: ({
    id,
    agent,
    executionTargetId
  }: {
    id: string;
    agent: string;
    executionTargetId?: string | null;
  }) => {
    const params = new URLSearchParams({ agent });
    if (executionTargetId) params.set('executionTargetId', executionTargetId);
    return request<ObjectiveEffectiveLaunchConfigDto>(
      'GET',
      `/api/objectives/${id}/effective-launch-config?${params.toString()}`
    );
  },

  // A `workspaceId` targets the workspace-scoped agent-catalog routes (any
  // workspace the caller is a member of); omit it for the active-workspace
  // legacy routes.
  getAgentCatalog: (workspaceId?: string | null) =>
    request<AgentCatalogDto>(
      'GET',
      workspaceId ? `/api/workspaces/${workspaceId}/agent-catalog` : '/api/agent-catalog'
    ),
  updateAgentCatalog: (body: UpdateAgentCatalogBody, workspaceId?: string | null) =>
    request<AgentCatalogDto>(
      'PUT',
      workspaceId ? `/api/workspaces/${workspaceId}/agent-catalog` : '/api/agent-catalog',
      body
    ),
  refreshAgentCatalog: (workspaceId?: string | null) =>
    request<AgentCatalogDto>(
      'POST',
      workspaceId
        ? `/api/workspaces/${workspaceId}/agent-catalog/refresh`
        : '/api/agent-catalog/refresh'
    ),
  // A `workspaceId` targets the workspace-scoped launch-settings routes (the
  // config for a mission in any workspace the caller belongs to); omit it for
  // the active-workspace legacy routes. Scoping the write to the resource's
  // workspace is what makes a secondary-workspace mission launch with its own
  // pre-command/flags (coo:331 Phase 0).
  getLaunchSettings: (workspaceId?: string | null) =>
    request<LaunchSettingsDto>(
      'GET',
      workspaceId ? `/api/workspaces/${workspaceId}/launch-settings` : '/api/launch-settings'
    ),
  updateAgentLaunchConfig: (
    agentKey: string,
    body: UpdateAgentLaunchConfigBody,
    workspaceId?: string | null
  ) =>
    request<LaunchSettingsDto>(
      'PATCH',
      workspaceId
        ? `/api/workspaces/${workspaceId}/launch-settings/agents/${encodeURIComponent(agentKey)}`
        : `/api/launch-settings/agents/${encodeURIComponent(agentKey)}`,
      body
    ),
  updateTerminalProfile: (body: UpdateTerminalProfileBody, workspaceId?: string | null) =>
    request<LaunchSettingsDto>(
      'PATCH',
      workspaceId
        ? `/api/workspaces/${workspaceId}/launch-settings/terminal-profile`
        : '/api/launch-settings/terminal-profile',
      body
    ),
  // The user-level provider/viewer default a new execution target inherits. It is
  // stored on the profile, not the target, so this works on a machine that has
  // not declared one.
  updateLaunchSessionDefaults: (
    body: UpdateLaunchSessionDefaultsBody,
    workspaceId?: string | null
  ) =>
    request<LaunchSettingsDto>(
      'PATCH',
      workspaceId
        ? `/api/workspaces/${workspaceId}/launch-settings/session-defaults`
        : '/api/launch-settings/session-defaults',
      body
    ),
  getLaunchPreference: (projectId: string) =>
    request<LaunchPreferenceDto>('GET', `/api/projects/${projectId}/launch-preference`),
  updateLaunchPreference: (projectId: string, body: UpdateLaunchPreferenceBody) =>
    request<LaunchPreferenceDto>('PUT', `/api/projects/${projectId}/launch-preference`, body),
  getProjectExecutionTarget: (projectId: string) =>
    request<ProjectExecutionTargetDto>('GET', `/api/projects/${projectId}/execution-target`),
  updateProjectExecutionTarget: (projectId: string, body: UpdateProjectExecutionTargetBody) =>
    request<ProjectExecutionTargetDto>('PUT', `/api/projects/${projectId}/execution-target`, body)
};
