import { PERMISSIONS } from '@overlord/auth';
import type {
  CreatedGitHubRepositoryDto,
  CreateGitHubPullRequestBody,
  GitHubInstallUrlDto,
  GitHubIntegrationDto,
  GitHubPullRequestDto,
  GitHubRepoSummaryDto,
  LinkProjectGitHubBody,
  ProjectGitHubLinkDto
} from '@overlord/contract/ext/github';
import type { DatabaseClient } from '@overlord/database';
import { createHmac, createSign, timingSafeEqual } from 'node:crypto';

import { newId, nowIso, recordChange, requireDatabaseClient } from '../../db.ts';
import { ApiError } from '../../errors.ts';
import { requireWorkspacePermission } from '../../rbac.ts';

const GITHUB_API = 'https://api.github.com';
const STATE_TTL_MS = 10 * 60 * 1000;

type InstallationRow = {
  id: string;
  github_installation_id: string;
  github_account_login: string;
  github_account_type: string | null;
  permissions_json: string;
  revision: number;
};
type ProjectLinkRow = {
  id: string;
  github_repo_id: string;
  full_name: string;
  default_branch: string;
  revision: number;
};
type PullRequestRow = {
  id: string;
  github_pull_number: number;
  html_url: string;
  state: 'open' | 'closed';
  head_branch: string;
  base_branch: string;
  revision: number;
};

function githubAppConfig(): { appId: string; privateKey: string; slug: string } | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  return appId && privateKey && slug ? { appId, privateKey, slug } : null;
}

function requireGitHubAppConfig(): { appId: string; privateKey: string; slug: string } {
  const config = githubAppConfig();
  if (!config) {
    throw new ApiError(
      400,
      'GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_SLUG.'
    );
  }
  return config;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function appJwt(config: { appId: string; privateKey: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const encodedPayload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: config.appId })
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(config.privateKey, 'base64url')}`;
}

async function githubFetch<T>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
  } catch (error) {
    throw new ApiError(502, `Could not reach GitHub: ${(error as Error).message}`);
  }
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      detail = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      // GitHub occasionally returns non-JSON proxy errors.
    }
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new ApiError(
      status,
      `GitHub API error (${response.status}): ${detail || response.statusText}`
    );
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

function signedInstallState(workspaceId: string, privateKey: string): string {
  const payload = base64url(JSON.stringify({ workspaceId, expiresAt: Date.now() + STATE_TTL_MS }));
  const mac = createHmac('sha256', privateKey).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verifyInstallState(value: string | undefined, privateKey: string): string {
  const [payload, suppliedMac, ...extra] = value?.split('.') ?? [];
  if (!payload || !suppliedMac || extra.length)
    throw new ApiError(400, 'Invalid GitHub installation state.');
  const expectedMac = createHmac('sha256', privateKey).update(payload).digest('base64url');
  const sameLength = suppliedMac.length === expectedMac.length;
  if (!sameLength || !timingSafeEqual(Buffer.from(suppliedMac), Buffer.from(expectedMac))) {
    throw new ApiError(400, 'Invalid GitHub installation state.');
  }
  let decoded: { workspaceId?: unknown; expiresAt?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new ApiError(400, 'Invalid GitHub installation state.');
  }
  if (
    typeof decoded.workspaceId !== 'string' ||
    typeof decoded.expiresAt !== 'number' ||
    decoded.expiresAt < Date.now()
  ) {
    throw new ApiError(400, 'GitHub installation state has expired. Start installation again.');
  }
  return decoded.workspaceId;
}

async function readInstallation(
  client: DatabaseClient = requireDatabaseClient(),
  workspaceId: string
): Promise<InstallationRow | null> {
  return (
    (await client.get<InstallationRow>(
      `SELECT id, github_installation_id, github_account_login, github_account_type, permissions_json, revision
         FROM ext_github_installations
        WHERE workspace_id = ? AND deleted_at IS NULL`,
      [workspaceId]
    )) ?? null
  );
}

async function requireInstallationToken(workspaceId: string): Promise<string> {
  const installation = await readInstallation(undefined, workspaceId);
  if (!installation)
    throw new ApiError(400, 'Install the GitHub App in Settings → Integrations first.');
  const config = requireGitHubAppConfig();
  const result = await githubFetch<{ token: string }>(
    `/app/installations/${encodeURIComponent(installation.github_installation_id)}/access_tokens`,
    appJwt(config),
    { method: 'POST' }
  );
  if (!result.token) throw new ApiError(502, 'GitHub did not return an installation access token.');
  return result.token;
}

async function assertProject(
  projectId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<string> {
  const project = await client.get(
    `SELECT workspace_id FROM projects WHERE id = ? AND deleted_at IS NULL`,
    [projectId]
  );
  if (!project) throw new ApiError(404, 'Project not found.');
  return (project as { workspace_id: string }).workspace_id;
}

async function readProjectLink(
  projectId: string,
  workspaceId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<ProjectLinkRow | null> {
  return (
    (await client.get<ProjectLinkRow>(
      `SELECT id, github_repo_id, full_name, default_branch, revision
         FROM ext_github_project_links
        WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL`,
      [workspaceId, projectId]
    )) ?? null
  );
}

function repoDto(row: ProjectLinkRow): GitHubRepoSummaryDto {
  return {
    id: row.github_repo_id,
    fullName: row.full_name,
    defaultBranch: row.default_branch,
    private: false
  };
}

export async function getGitHubIntegration(workspaceId: string): Promise<GitHubIntegrationDto> {
  await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.WORKSPACE_READ,
    notFoundMessage: 'Workspace not found'
  });
  const installation = await readInstallation(undefined, workspaceId);
  const workspace = await requireDatabaseClient().get<{ name: string }>(
    `SELECT name FROM workspaces WHERE id = ? AND deleted_at IS NULL`,
    [workspaceId]
  );
  return {
    configured: githubAppConfig() !== null,
    connected: installation !== null,
    accountLogin: installation?.github_account_login ?? null,
    accountType: installation?.github_account_type ?? null,
    workspaceName: workspace?.name ?? ''
  };
}

export async function beginGitHubInstall(workspaceId: string): Promise<GitHubInstallUrlDto> {
  await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.WORKSPACE_UPDATE,
    notFoundMessage: 'Workspace not found'
  });
  const config = requireGitHubAppConfig();
  const state = signedInstallState(workspaceId, config.privateKey);
  return {
    installUrl: `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(state)}`
  };
}

export async function completeGitHubInstall(input: {
  installationId: string;
  state?: string;
}): Promise<GitHubIntegrationDto> {
  const config = requireGitHubAppConfig();
  const workspaceId = verifyInstallState(input.state, config.privateKey);
  await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.WORKSPACE_UPDATE,
    notFoundMessage: 'Workspace not found'
  });
  if (!/^\d+$/.test(input.installationId))
    throw new ApiError(400, 'GitHub installation id is invalid.');
  const upstream = await githubFetch<{
    account?: { login?: string; type?: string };
    permissions?: Record<string, string>;
  }>(`/app/installations/${input.installationId}`, appJwt(config));
  const accountLogin = upstream.account?.login?.trim();
  if (!accountLogin) throw new ApiError(502, 'GitHub installation has no account login.');
  await requireDatabaseClient().transaction(async tx => {
    const existing = await readInstallation(tx, workspaceId);
    const now = nowIso();
    if (existing) {
      const revision = existing.revision + 1;
      await tx.run(
        `UPDATE ext_github_installations
            SET github_installation_id = ?, github_account_login = ?, github_account_type = ?, permissions_json = ?, updated_at = ?, revision = ?
          WHERE id = ? AND revision = ?`,
        [
          input.installationId,
          accountLogin,
          upstream.account?.type ?? null,
          JSON.stringify(upstream.permissions ?? {}),
          now,
          revision,
          existing.id,
          existing.revision
        ]
      );
      await recordChange(
        {
          entityType: 'github:installation',
          entityId: existing.id,
          operation: 'update',
          entityRevision: revision,
          changedFields: ['connected', 'accountLogin'],
          workspaceId
        },
        tx
      );
    } else {
      const id = newId();
      await tx.run(
        `INSERT INTO ext_github_installations (id, workspace_id, github_installation_id, github_account_login, github_account_type, permissions_json, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          id,
          workspaceId,
          input.installationId,
          accountLogin,
          upstream.account?.type ?? null,
          JSON.stringify(upstream.permissions ?? {}),
          now,
          now
        ]
      );
      await recordChange(
        {
          entityType: 'github:installation',
          entityId: id,
          operation: 'insert',
          entityRevision: 1,
          changedFields: ['connected', 'accountLogin'],
          workspaceId
        },
        tx
      );
    }
  });
  return getGitHubIntegration(workspaceId);
}

export async function disconnectGitHub(workspaceId: string): Promise<GitHubIntegrationDto> {
  await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.WORKSPACE_UPDATE,
    notFoundMessage: 'Workspace not found'
  });
  await requireDatabaseClient().transaction(async tx => {
    const installation = await readInstallation(tx, workspaceId);
    if (!installation) return;
    const now = nowIso();
    const revision = installation.revision + 1;
    await tx.run(
      `UPDATE ext_github_installations SET deleted_at = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ?`,
      [now, now, revision, installation.id, installation.revision]
    );
    await tx.run(
      `UPDATE ext_github_project_links SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE workspace_id = ? AND deleted_at IS NULL`,
      [now, now, workspaceId]
    );
    await recordChange(
      {
        entityType: 'github:installation',
        entityId: installation.id,
        operation: 'delete',
        entityRevision: revision,
        changedFields: ['connected'],
        workspaceId
      },
      tx
    );
  });
  return getGitHubIntegration(workspaceId);
}

export async function listGitHubRepos(
  query: string | null,
  workspaceId: string
): Promise<GitHubRepoSummaryDto[]> {
  await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.PROJECT_READ,
    notFoundMessage: 'Workspace not found'
  });
  const token = await requireInstallationToken(workspaceId);
  const data = await githubFetch<{
    repositories?: Array<{
      id: number;
      full_name: string;
      default_branch?: string;
      private?: boolean;
    }>;
  }>('/installation/repositories?per_page=100', token);
  const needle = query?.trim().toLowerCase();
  return (data.repositories ?? [])
    .filter(repo => !needle || repo.full_name.toLowerCase().includes(needle))
    .map(repo => ({
      id: String(repo.id),
      fullName: repo.full_name,
      defaultBranch: repo.default_branch ?? 'main',
      private: Boolean(repo.private)
    }));
}

export async function getProjectGitHubLink(projectId: string): Promise<ProjectGitHubLinkDto> {
  const workspaceId = await assertProject(projectId);
  const link = await readProjectLink(projectId, workspaceId);
  return { projectId, repo: link ? repoDto(link) : null };
}

export async function linkProjectGitHub(
  projectId: string,
  body: LinkProjectGitHubBody
): Promise<ProjectGitHubLinkDto> {
  const workspaceId = await assertProject(projectId);
  const fullName = body.repoFullName?.trim() ?? '';
  if (!fullName) {
    const existing = await readProjectLink(projectId, workspaceId);
    if (existing) {
      const now = nowIso();
      await requireDatabaseClient().run(
        `UPDATE ext_github_project_links SET deleted_at = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ?`,
        [now, now, existing.revision + 1, existing.id, existing.revision]
      );
    }
    return { projectId, repo: null };
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(fullName))
    throw new ApiError(400, 'Repository must be written as owner/name.');
  const token = await requireInstallationToken(workspaceId);
  const repo = await githubFetch<{
    id: number;
    full_name: string;
    default_branch?: string;
    private?: boolean;
  }>(`/repos/${fullName.split('/').map(encodeURIComponent).join('/')}`, token);
  const next = {
    id: String(repo.id),
    fullName: repo.full_name,
    defaultBranch: repo.default_branch ?? 'main',
    private: Boolean(repo.private)
  };
  await requireDatabaseClient().transaction(async tx => {
    const existing = await readProjectLink(projectId, workspaceId, tx);
    const now = nowIso();
    if (existing) {
      await tx.run(
        `UPDATE ext_github_project_links SET github_repo_id = ?, full_name = ?, default_branch = ?, metadata_json = ?, deleted_at = NULL, updated_at = ?, revision = ? WHERE id = ? AND revision = ?`,
        [
          next.id,
          next.fullName,
          next.defaultBranch,
          JSON.stringify({ private: next.private }),
          now,
          existing.revision + 1,
          existing.id,
          existing.revision
        ]
      );
      await recordChange(
        {
          entityType: 'github:project_link',
          entityId: existing.id,
          operation: 'update',
          entityRevision: existing.revision + 1,
          projectId,
          changedFields: ['repo'],
          workspaceId
        },
        tx
      );
    } else {
      const id = newId();
      await tx.run(
        `INSERT INTO ext_github_project_links (id, workspace_id, project_id, github_repo_id, full_name, default_branch, metadata_json, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          id,
          workspaceId,
          projectId,
          next.id,
          next.fullName,
          next.defaultBranch,
          JSON.stringify({ private: next.private }),
          now,
          now
        ]
      );
      await recordChange(
        {
          entityType: 'github:project_link',
          entityId: id,
          operation: 'insert',
          entityRevision: 1,
          projectId,
          changedFields: ['repo'],
          workspaceId
        },
        tx
      );
    }
  });
  return { projectId, repo: next };
}

async function readPullRequest(
  missionId: string,
  workspaceId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<PullRequestRow | null> {
  return (
    (await client.get<PullRequestRow>(
      `SELECT id, github_pull_number, html_url, state, head_branch, base_branch, revision FROM ext_github_mission_pull_requests WHERE workspace_id = ? AND mission_id = ? AND deleted_at IS NULL`,
      [workspaceId, missionId]
    )) ?? null
  );
}

function pullRequestDto(row: PullRequestRow): GitHubPullRequestDto {
  return {
    number: row.github_pull_number,
    url: row.html_url,
    state: row.state,
    headBranch: row.head_branch,
    baseBranch: row.base_branch
  };
}

export async function getMissionGitHubPullRequest(
  missionId: string
): Promise<GitHubPullRequestDto | null> {
  const mission = await requireDatabaseClient().get<{ workspace_id: string }>(
    `SELECT workspace_id FROM missions WHERE id = ? AND deleted_at IS NULL`,
    [missionId]
  );
  if (!mission) throw new ApiError(404, 'Mission not found.');
  const row = await readPullRequest(missionId, mission.workspace_id);
  return row ? pullRequestDto(row) : null;
}

export type ProjectInitializationRow = {
  id: string;
  project_id: string;
  mission_id: string;
  github_owner_login: string | null;
  provisioning_status: 'not_requested' | 'pending' | 'failed' | 'succeeded';
  github_repo_id: string | null;
  full_name: string | null;
  default_branch: string | null;
  clone_url: string | null;
  failure_message: string | null;
  revision: number;
};

const PROJECT_INITIALIZATION_SELECT = `SELECT id, project_id, mission_id, github_owner_login, provisioning_status,
              github_repo_id, full_name, default_branch, clone_url, failure_message, revision`;

export async function readProjectInitialization(
  tx: DatabaseClient,
  profileId: string,
  idempotencyKey: string
): Promise<ProjectInitializationRow | null> {
  return (
    (await tx.get<ProjectInitializationRow>(
      `${PROJECT_INITIALIZATION_SELECT}
         FROM ext_github_project_initializations
        WHERE profile_id = ? AND idempotency_key = ? AND deleted_at IS NULL`,
      [profileId, idempotencyKey]
    )) ?? null
  );
}

export async function readProjectInitializationById(
  tx: DatabaseClient,
  id: string
): Promise<ProjectInitializationRow | null> {
  return (
    (await tx.get<ProjectInitializationRow>(
      `${PROJECT_INITIALIZATION_SELECT}
         FROM ext_github_project_initializations WHERE id = ? AND deleted_at IS NULL`,
      [id]
    )) ?? null
  );
}

export async function createProjectInitialization(
  tx: DatabaseClient,
  input: {
    id: string;
    profileId: string;
    workspaceId: string;
    projectId: string;
    missionId: string;
    idempotencyKey: string;
    ownerLogin: string | null;
    status: ProjectInitializationRow['provisioning_status'];
    now: string;
  }
): Promise<ProjectInitializationRow> {
  await tx.run(
    `INSERT INTO ext_github_project_initializations
        (id, profile_id, workspace_id, project_id, mission_id, idempotency_key, github_owner_login,
         provisioning_status, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      input.id,
      input.profileId,
      input.workspaceId,
      input.projectId,
      input.missionId,
      input.idempotencyKey,
      input.ownerLogin,
      input.status,
      input.now,
      input.now
    ]
  );
  return {
    id: input.id,
    project_id: input.projectId,
    mission_id: input.missionId,
    github_owner_login: input.ownerLogin,
    provisioning_status: input.status,
    github_repo_id: null,
    full_name: null,
    default_branch: null,
    clone_url: null,
    failure_message: null,
    revision: 1
  };
}

export async function recordProvisioningFailure(
  tx: DatabaseClient,
  input: { id: string; message: string; now: string }
): Promise<void> {
  await tx.run(
    `UPDATE ext_github_project_initializations
            SET provisioning_status = 'failed', failure_message = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND provisioning_status <> 'succeeded' AND deleted_at IS NULL`,
    [input.message.slice(0, 500), input.now, input.id]
  );
}

export async function recordProvisioningSuccess(
  tx: DatabaseClient,
  input: { id: string; repo: CreatedGitHubRepositoryDto; now: string }
): Promise<ProjectInitializationRow> {
  await tx.run(
    `UPDATE ext_github_project_initializations SET provisioning_status = 'succeeded', github_repo_id = ?,
          full_name = ?, default_branch = ?, clone_url = ?, failure_message = NULL, updated_at = ?, revision = revision + 1
        WHERE id = ?`,
    [
      input.repo.id,
      input.repo.fullName,
      input.repo.defaultBranch,
      input.repo.cloneUrl,
      input.now,
      input.id
    ]
  );
  return (await readProjectInitializationById(tx, input.id))!;
}

export async function recordPrivateRepositoryLink(
  tx: DatabaseClient,
  input: {
    project: { id: string; workspaceId: string };
    repo: CreatedGitHubRepositoryDto;
    now: string;
  }
): Promise<void> {
  const existingLink = await tx.get<{ id: string }>(
    `SELECT id FROM ext_github_project_links WHERE project_id = ? AND deleted_at IS NULL`,
    [input.project.id]
  );
  if (existingLink) return;
  const linkId = newId();
  await tx.run(
    `INSERT INTO ext_github_project_links
          (id, workspace_id, project_id, github_repo_id, full_name, default_branch, metadata_json, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      linkId,
      input.project.workspaceId,
      input.project.id,
      input.repo.id,
      input.repo.fullName,
      input.repo.defaultBranch,
      JSON.stringify({ private: true, source: 'user_oauth' }),
      input.now,
      input.now
    ]
  );
  await recordChange(
    {
      entityType: 'github:project_link',
      entityId: linkId,
      operation: 'insert',
      entityRevision: 1,
      projectId: input.project.id,
      changedFields: ['repo'],
      workspaceId: input.project.workspaceId
    },
    tx
  );
}

export async function createMissionGitHubPullRequest(
  missionId: string,
  body: CreateGitHubPullRequestBody
): Promise<GitHubPullRequestDto> {
  const mission = await requireDatabaseClient().get<{
    id: string;
    workspace_id: string;
    project_id: string;
    title: string;
    active_branch: string | null;
  }>(
    `SELECT id, workspace_id, project_id, title, active_branch FROM missions WHERE id = ? AND deleted_at IS NULL`,
    [missionId]
  );
  if (!mission) throw new ApiError(404, 'Mission not found.');
  const existing = await readPullRequest(missionId, mission.workspace_id);
  if (existing) return pullRequestDto(existing);
  if (!mission.active_branch?.trim())
    throw new ApiError(409, 'Publish the mission branch before opening a pull request.');
  const link = await readProjectLink(mission.project_id, mission.workspace_id);
  if (!link)
    throw new ApiError(400, 'Link this project to a GitHub repository in project settings first.');
  const token = await requireInstallationToken(mission.workspace_id);
  const pr = await githubFetch<{ number: number; html_url: string; state: 'open' | 'closed' }>(
    `/repos/${link.full_name.split('/').map(encodeURIComponent).join('/')}/pulls`,
    token,
    {
      method: 'POST',
      body: {
        title: body.title?.trim() || mission.title,
        body: body.body?.trim() || undefined,
        draft: Boolean(body.draft),
        head: mission.active_branch,
        base: link.default_branch
      }
    }
  );
  const now = nowIso();
  const id = newId();
  await requireDatabaseClient().transaction(async tx => {
    const concurrent = await readPullRequest(missionId, mission.workspace_id, tx);
    if (concurrent) return;
    await tx.run(
      `INSERT INTO ext_github_mission_pull_requests (id, workspace_id, project_id, mission_id, github_pull_number, html_url, state, head_branch, base_branch, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        mission.workspace_id,
        mission.project_id,
        missionId,
        pr.number,
        pr.html_url,
        pr.state,
        mission.active_branch,
        link.default_branch,
        now,
        now
      ]
    );
    await recordChange(
      {
        entityType: 'github:mission_pull_request',
        entityId: id,
        operation: 'insert',
        entityRevision: 1,
        projectId: mission.project_id,
        missionId,
        changedFields: ['pullRequest'],
        workspaceId: mission.workspace_id
      },
      tx
    );
  });
  return {
    number: pr.number,
    url: pr.html_url,
    state: pr.state,
    headBranch: mission.active_branch,
    baseBranch: link.default_branch
  };
}
