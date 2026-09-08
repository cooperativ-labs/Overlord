import type { ProjectListLifecycle } from '../../shared/contract.ts';

/**
 * How much of a board's terminal (`complete` / `cancelled`) history is loaded.
 * Boards open on `recent` — the server's rolling completed-mission window — and
 * switch to `all-completed` when the operator asks for older missions.
 */
export type MissionBoardScope = 'recent' | 'all-completed';

export const keys = {
  meta: ['meta'] as const,
  profile: ['profile'] as const,
  userTokens: ['user-tokens'] as const,
  webhookSubscriptions: (workspaceId: string) => ['webhooks', workspaceId] as const,
  webhookDeliveries: (id: string) => ['webhooks', id, 'deliveries'] as const,
  organizations: ['organizations'] as const,
  organizationAdmins: (id: string) => ['organization', id, 'admins'] as const,
  defaultProject: ['profile', 'default-project'] as const,
  inbox: ['inbox'] as const,
  /** Cross-workspace recent + agent-Next missions shown in the Inbox column. */
  inboxMissions: ['inbox-missions'] as const,
  /** Cross-workspace objective activity feed rendered on the Feed page. */
  activityFeed: ['activity-feed'] as const,
  /** Cross-workspace human follow-up actions rail on the Feed page; prefix for both scopes. */
  humanActions: ['human-actions'] as const,
  humanActionsScoped: (includeResolved: boolean) =>
    ['human-actions', includeResolved ? 'all' : 'open'] as const,
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
  runQueues: (projectId: string) => ['project', projectId, 'run-queues'] as const,
  projectStatuses: (projectId: string) => ['project', projectId, 'statuses'] as const,
  workspaceProjectStatuses: (workspaceId: string) =>
    ['workspace', workspaceId, 'project-statuses'] as const,
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
  /**
   * One project board's missions for a given completed-mission scope (coo:941).
   * `recent` holds the default rolling window; `all-completed` holds the
   * expanded archive. Both sit under `missions(projectId)`, so every existing
   * prefix invalidation still refreshes them together.
   */
  missionsScoped: (projectId: string, scope: MissionBoardScope) =>
    ['project', projectId, 'missions', scope] as const,
  myMissions: ['workspace', 'my-missions'] as const,
  /** My Missions for one completed-mission scope; see `missionsScoped`. */
  myMissionsScoped: (scope: MissionBoardScope) => ['workspace', 'my-missions', scope] as const,
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
  missionAgentRequests: (id: string, objectiveId?: string | null) =>
    objectiveId
      ? (['mission', id, 'agent-requests', objectiveId] as const)
      : (['mission', id, 'agent-requests'] as const),
  /** Inbound instructions queued from Overlord into a mission's live session. */
  missionAgentSessionInputs: (id: string) => ['mission', id, 'agent-session-inputs'] as const,
  objectiveAttachments: (objectiveId: string) => ['objective', objectiveId, 'attachments'] as const,
  objectiveEffectiveLaunchConfig: (
    objectiveId: string,
    agent: string,
    executionTargetId?: string | null
  ) =>
    [
      'objective',
      objectiveId,
      'effective-launch-config',
      agent,
      executionTargetId ?? 'selected'
    ] as const,
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
  githubIntegration: (workspaceId: string) => ['integrations', 'github', workspaceId] as const,
  projectGitHubLink: (projectId: string) => ['project', projectId, 'github-link'] as const,
  missionGitHubPullRequest: (id: string) => ['mission', id, 'github-pull-request'] as const
};
