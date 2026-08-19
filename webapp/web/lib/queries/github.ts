import type { LinkProjectGitHubBody } from '@overlord/contract/ext/github';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api.ts';
import { keys } from '../query-keys.ts';

export const useGitHubIntegration = (workspaceId: string) =>
  useQuery({
    queryKey: keys.githubIntegration(workspaceId),
    queryFn: () => api.getGitHubIntegration(workspaceId),
    enabled: Boolean(workspaceId)
  });

export function useBeginGitHubInstall(workspaceId: string) {
  return useMutation({ mutationFn: () => api.beginGitHubInstall(workspaceId) });
}

export function useDisconnectGitHub(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.disconnectGitHub(workspaceId),
    onSuccess: data => {
      qc.setQueryData(keys.githubIntegration(workspaceId), data);
      void qc.invalidateQueries({ predicate: query => query.queryKey[2] === 'github-link' });
    }
  });
}

export const useProjectGitHubLink = (projectId: string, options: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: keys.projectGitHubLink(projectId),
    queryFn: () => api.getProjectGitHubLink(projectId),
    enabled: options.enabled ?? true
  });

export function useLinkProjectGitHub(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkProjectGitHubBody) => api.linkProjectGitHub(projectId, body),
    onSuccess: data => qc.setQueryData(keys.projectGitHubLink(projectId), data)
  });
}

export const useMissionGitHubPullRequest = (missionId: string) =>
  useQuery({
    queryKey: keys.missionGitHubPullRequest(missionId),
    queryFn: () => api.getMissionGitHubPullRequest(missionId)
  });

export function useCreateMissionGitHubPullRequest(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.createMissionGitHubPullRequest(missionId),
    onSuccess: data => qc.setQueryData(keys.missionGitHubPullRequest(missionId), data)
  });
}
