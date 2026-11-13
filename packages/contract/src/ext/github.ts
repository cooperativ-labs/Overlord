// ---- GitHub extension contract -------------------------------------------
//
// All GitHub endpoints are namespaced under `/ext/github`. Credentials remain
// server-side; DTOs expose only installation and repository metadata.
import type { GitHubRepoSummaryDto } from '../generated/api.js';

// REST DTOs generated from contract/api/openapi.yaml (ADR 0006).
export type {
  CreateGitHubPullRequestBody,
  GitHubInstallUrlDto,
  GitHubIntegrationDto,
  GitHubPullRequestDto,
  GitHubRepositoryOwnerDto,
  GitHubRepositoryOwnerList,
  GitHubRepoSummaryDto,
  GitHubRepoSummaryList,
  LinkProjectGitHubBody,
  ProjectGitHubLinkDto
} from '../generated/api.js';

/** Non-secret repository metadata returned only after user-OAuth provisioning. */
export interface CreatedGitHubRepositoryDto extends GitHubRepoSummaryDto {
  private: true;
  cloneUrl: string;
}
