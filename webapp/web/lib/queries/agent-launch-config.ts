import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  LaunchObjectiveBody,
  LaunchPreferenceDto,
  ObjectiveEffectiveLaunchConfigDto,
  UpdateAgentCatalogBody,
  UpdateAgentLaunchConfigBody,
  UpdateLaunchPreferenceBody,
  UpdateLaunchSessionDefaultsBody,
  UpdateProjectExecutionTargetBody,
  UpdateTerminalProfileBody
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { invalidateNonEverhourQueries } from '../query-invalidation.ts';
import { keys } from '../query-keys.ts';

function invalidateAll(qc: QueryClient) {
  invalidateNonEverhourQueries(qc);
}

export const useAgentCatalog = (
  workspaceId?: string | null,
  { enabled = true }: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: keys.agentCatalog(workspaceId),
    queryFn: () => api.getAgentCatalog(workspaceId),
    enabled,
    staleTime: 60_000
  });

export const useLaunchSettings = (
  workspaceId?: string | null,
  { enabled = true }: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: keys.launchSettings(workspaceId),
    queryFn: () => api.getLaunchSettings(workspaceId),
    enabled,
    staleTime: 60_000
  });

export const useLaunchPreference = (projectId: string) =>
  useQuery({
    queryKey: keys.launchPreference(projectId),
    queryFn: () => api.getLaunchPreference(projectId),
    staleTime: 60_000,
    enabled: Boolean(projectId)
  });

export const useObjectiveEffectiveLaunchConfig = ({
  objectiveId,
  agent,
  executionTargetId,
  enabled = true
}: {
  objectiveId: string;
  agent: string;
  executionTargetId?: string | null;
  enabled?: boolean;
}) =>
  useQuery<ObjectiveEffectiveLaunchConfigDto>({
    queryKey: keys.objectiveEffectiveLaunchConfig(objectiveId, agent, executionTargetId),
    queryFn: () =>
      api.getObjectiveEffectiveLaunchConfig({ id: objectiveId, agent, executionTargetId }),
    enabled: enabled && Boolean(objectiveId) && Boolean(agent),
    staleTime: 30_000
  });

export const useProjectExecutionTarget = (projectId: string) =>
  useQuery({
    queryKey: keys.projectExecutionTarget(projectId),
    queryFn: () => api.getProjectExecutionTarget(projectId),
    staleTime: 30_000,
    enabled: Boolean(projectId)
  });

export function useUpdateProjectExecutionTarget(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProjectExecutionTargetBody) =>
      api.updateProjectExecutionTarget(projectId, body),
    onSuccess: data => {
      qc.setQueryData(keys.projectExecutionTarget(projectId), data);
      void qc.invalidateQueries({
        queryKey: keys.projectRepository(projectId, data.selectedExecutionTargetId)
      });
    }
  });
}

export function useLaunchObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LaunchObjectiveBody }) =>
      api.launchObjective(id, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useUpdateAgentLaunchConfig(workspaceId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentKey, body }: { agentKey: string; body: UpdateAgentLaunchConfigBody }) =>
      api.updateAgentLaunchConfig(agentKey, body, workspaceId),
    onSuccess: data => qc.setQueryData(keys.launchSettings(workspaceId), data)
  });
}

export function useUpdateTerminalProfile(workspaceId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTerminalProfileBody) => api.updateTerminalProfile(body, workspaceId),
    onSuccess: data => qc.setQueryData(keys.launchSettings(workspaceId), data)
  });
}

/**
 * The user-level session default (coo:702). Stored on the profile rather than a
 * target, so this succeeds on a machine that has not declared an execution
 * target — targets that never override it follow this value.
 */
export function useUpdateLaunchSessionDefaults(workspaceId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateLaunchSessionDefaultsBody) =>
      api.updateLaunchSessionDefaults(body, workspaceId),
    onSuccess: data => qc.setQueryData(keys.launchSettings(workspaceId), data)
  });
}

export function useUpdateLaunchPreference(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateLaunchPreferenceBody) => api.updateLaunchPreference(projectId, body),
    onMutate: async body => {
      // Optimistic: selection changes should feel instant in the selector.
      await qc.cancelQueries({ queryKey: keys.launchPreference(projectId) });
      const previous = qc.getQueryData<LaunchPreferenceDto>(keys.launchPreference(projectId));
      if (previous) {
        qc.setQueryData(keys.launchPreference(projectId), { ...previous, ...body });
      }
      return { previous };
    },
    onError: (_err, _body, context) => {
      if (context?.previous) {
        qc.setQueryData(keys.launchPreference(projectId), context.previous);
      }
    },
    onSuccess: data => qc.setQueryData(keys.launchPreference(projectId), data)
  });
}

export function useRefreshAgentCatalog(workspaceId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.refreshAgentCatalog(workspaceId),
    onSuccess: data => qc.setQueryData(keys.agentCatalog(workspaceId), data)
  });
}

export function useUpdateAgentCatalog(workspaceId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAgentCatalogBody) => api.updateAgentCatalog(body, workspaceId),
    onSuccess: data => qc.setQueryData(keys.agentCatalog(workspaceId), data)
  });
}
