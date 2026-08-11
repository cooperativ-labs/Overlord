import type { LinkProjectGitHubBody } from '@overlord/contract/ext/github';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api.ts';
import { keys } from '../query-keys.ts';

export const useGitHubIntegration = () =>
  useQuery({ queryKey: keys.githubIntegration, queryFn: () => api.getGitHubIntegration() });

export function useBeginGitHubInstall() {
  return useMutation({ mutationFn: () => api.beginGitHubInstall() });
}

export function useDisconnectGitHub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.disconnectGitHub(),
    onSuccess: data => {
      qc.setQueryData(keys.githubIntegration, data);
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
