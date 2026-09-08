import type {
  CreateGitHubPullRequestBody,
  GitHubInstallUrlDto,
  GitHubIntegrationDto,
  GitHubPullRequestDto,
  GitHubRepoSummaryDto,
  LinkProjectGitHubBody,
  ProjectGitHubLinkDto
} from '@overlord/contract/ext/github';

import { request } from './request.ts';

export const githubApi = {
  getGitHubIntegration: (workspaceId: string) =>
    request<GitHubIntegrationDto>(
      'GET',
      `/ext/github/integration?workspaceId=${encodeURIComponent(workspaceId)}`
    ),
  beginGitHubInstall: (workspaceId: string) =>
    request<GitHubInstallUrlDto>(
      'POST',
      `/ext/github/install?workspaceId=${encodeURIComponent(workspaceId)}`
    ),
  disconnectGitHub: (workspaceId: string) =>
    request<GitHubIntegrationDto>(
      'DELETE',
      `/ext/github/integration?workspaceId=${encodeURIComponent(workspaceId)}`
    ),
  listGitHubRepos: (query: string | undefined, workspaceId: string) =>
    request<GitHubRepoSummaryDto[]>(
      'GET',
      `/ext/github/repos?workspaceId=${encodeURIComponent(workspaceId)}${query ? `&q=${encodeURIComponent(query)}` : ''}`
    ),
  getProjectGitHubLink: (projectId: string) =>
    request<ProjectGitHubLinkDto>('GET', `/ext/github/projects/${projectId}/link`),
  linkProjectGitHub: (projectId: string, body: LinkProjectGitHubBody) =>
    request<ProjectGitHubLinkDto>('PUT', `/ext/github/projects/${projectId}/link`, body),
  getMissionGitHubPullRequest: (missionId: string) =>
    request<GitHubPullRequestDto | null>('GET', `/ext/github/missions/${missionId}/pull-request`),
  createMissionGitHubPullRequest: (missionId: string, body: CreateGitHubPullRequestBody = {}) =>
    request<GitHubPullRequestDto>('POST', `/ext/github/missions/${missionId}/pull-request`, body)
};
