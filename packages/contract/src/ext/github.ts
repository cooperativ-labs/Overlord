// ---- GitHub extension contract -------------------------------------------
//
// All GitHub endpoints are namespaced under `/ext/github`. Credentials remain
// server-side; DTOs expose only installation and repository metadata.

export interface GitHubUserAccountDto {
  id: string;
  login: string;
  avatarUrl: string | null;
}

export interface GitHubUserConnectionDto {
  configured: boolean;
  connected: boolean;
  account: GitHubUserAccountDto | null;
  scopes: string[];
}

export interface GitHubUserAuthorizationDto {
  authorizationUrl: string;
}

export interface BeginGitHubUserAuthorizationBody {
  returnTo?: string;
}

export interface GitHubRepositoryOwnerDto {
  login: string;
  type: 'personal' | 'organization';
  avatarUrl: string | null;
  canCreateRepositories: true;
}

export interface GitHubIntegrationDto {
  configured: boolean;
  connected: boolean;
  accountLogin: string | null;
  accountType: string | null;
}

export interface GitHubInstallUrlDto {
  installUrl: string;
}

export interface GitHubRepoSummaryDto {
  id: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

/** Non-secret repository metadata returned only after user-OAuth provisioning. */
export interface CreatedGitHubRepositoryDto extends GitHubRepoSummaryDto {
  private: true;
  cloneUrl: string;
}

export interface ProjectGitHubLinkDto {
  projectId: string;
  repo: GitHubRepoSummaryDto | null;
}

export interface LinkProjectGitHubBody {
  repoFullName: string | null;
}

export interface GitHubPullRequestDto {
  number: number;
  url: string;
  state: 'open' | 'closed';
  headBranch: string;
  baseBranch: string;
}

export interface CreateGitHubPullRequestBody {
  title?: string;
  body?: string;
  draft?: boolean;
}
