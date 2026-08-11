import type { ProjectListLifecycle } from '../../shared/contract.ts';

export const keys = {
  meta: ['meta'] as const,
  profile: ['profile'] as const,
  userTokens: ['user-tokens'] as const,
  webhookSubscriptions: ['webhooks'] as const,
  webhookDeliveries: (id: string) => ['webhooks', id, 'deliveries'] as const,
  organizations: ['organizations'] as const,
  organizationAdmins: (id: string) => ['organization', id, 'admins'] as const,
  defaultProject: ['profile', 'default-project'] as const,
  inbox: ['inbox'] as const,
  notifications: ['notifications'] as const,
  notificationPreferences: ['profile', 'notification-preferences'] as const,
  workspaces: ['workspaces'] as const,
  workspaceMembers: (id: string) => ['workspace', id, 'members'] as const,
  workspaceExecutionTargets: (id: string) => ['workspace', id, 'execution-targets'] as const,
  workspaceInvitations: (id: string) => ['workspace', id, 'invitations'] as const,
  projects: (workspaceId?: string, lifecycle: ProjectListLifecycle = 'active') =>
    workspaceId
      ? (['workspace', workspaceId, 'projects', lifecycle] as const)
      : (['projects', lifecycle] as const),
  project: (id: string) => ['project', id] as const,
  workspaceStatuses: (workspaceId?: string | null) =>
    workspaceId
      ? (['workspace', workspaceId, 'statuses'] as const)
      : (['workspace', 'statuses'] as const),
  projectResources: (id: string) => ['project', id, 'resources'] as const,
  projectTags: (id: string) => ['project', id, 'tags'] as const,
  projectRepository: (id: string, executionTargetId: string | null, resourceKey?: string | null) =>
    [
      'project',
      id,
      'repository',
      executionTargetId ?? 'primary',
      resourceKey ?? 'primary'
    ] as const,
  missions: (projectId: string) => ['project', projectId, 'missions'] as const,
  myMissions: ['workspace', 'my-missions'] as const,
  mission: (id: string) => ['mission', id] as const,
  missionSchedule: (id: string) => ['mission', id, 'schedule'] as const,
  missionBranches: (id: string) => ['mission', id, 'branches'] as const,
  worktrees: ['worktrees'] as const,
  missionEvents: (id: string) => ['mission', id, 'events'] as const,
  missionDeliveries: (id: string) => ['mission', id, 'deliveries'] as const,
  missionArtifacts: (id: string) => ['mission', id, 'artifacts'] as const,
  missionSharedContext: (id: string) => ['mission', id, 'context'] as const,
  missionFileChanges: (id: string) => ['mission', id, 'file-changes'] as const,
  /** Answerable agent-session requests (permission / question / choice / retry) for a mission. */
  missionAgentRequests: (id: string) => ['mission', id, 'agent-requests'] as const,
  /** Inbound instructions queued from Overlord into a mission's live session. */
  missionAgentSessionInputs: (id: string) => ['mission', id, 'agent-session-inputs'] as const,
  objectiveAttachments: (objectiveId: string) => ['objective', objectiveId, 'attachments'] as const,
  agentCatalog: (workspaceId?: string | null) =>
    workspaceId ? (['agent-catalog', workspaceId] as const) : (['agent-catalog'] as const),
  runnerStatus: ['runner', 'status'] as const,
  runnerServiceStatus: ['runner', 'service-status'] as const,
  launchSettings: (workspaceId?: string | null) =>
    workspaceId ? (['launch-settings', workspaceId] as const) : (['launch-settings'] as const),
  launchPreference: (projectId: string) => ['project', projectId, 'launch-preference'] as const,
  projectExecutionTarget: (projectId: string) =>
    ['project', projectId, 'execution-target'] as const,
  everhourIntegration: ['integrations', 'everhour'] as const,
  projectEverhourLink: (projectId: string) => ['project', projectId, 'everhour-link'] as const,
  projectEverhour: (projectId: string) => ['project', projectId, 'everhour'] as const,
  missionEverhour: (id: string) => ['mission', id, 'everhour'] as const,
  githubIntegration: ['integrations', 'github'] as const,
  projectGitHubLink: (projectId: string) => ['project', projectId, 'github-link'] as const,
  missionGitHubPullRequest: (id: string) => ['mission', id, 'github-pull-request'] as const
};
