import type {
  CreateEverhourTimeBody,
  LinkProjectEverhourBody,
  UpdateEverhourTimeBody
} from '@overlord/contract/ext/everhour';
import type { LinkProjectGitHubBody } from '@overlord/contract/ext/github';
import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';

import type {
  AcceptWorkspaceInvitationBody,
  ActivityFeedDto,
  AddOrganizationAdminBody,
  BranchActionBody,
  CreateInboxItemBody,
  CreateMissionBody,
  CreateObjectiveBody,
  CreateOrganizationOnboardingBody,
  CreateProjectBody,
  CreateProjectResourceBody,
  CreateProjectStatusBody,
  CreateProjectTagBody,
  CreateUserTokenBody,
  CreateWebhookSubscriptionBody,
  CreateWorkspaceBody,
  DeliveryDto,
  InboxItemDto,
  InviteWorkspaceMemberBody,
  LaunchObjectiveBody,
  LaunchPreferenceDto,
  MissionDetailDto,
  MissionDto,
  MissionScheduleDto,
  MyMissionsResponse,
  NotificationDto,
  ObjectiveAttachmentDto,
  ObjectiveEffectiveLaunchConfigDto,
  PreviewScheduleBody,
  ProjectDto,
  ProjectListLifecycle,
  ProjectRunQueuesDto,
  ProjectStatusDto,
  ProjectTagDto,
  RemoveWorktreeBody,
  ReorderFutureObjectivesBody,
  ReorderProjectsBody,
  ReorderProjectStatusesBody,
  ScheduleInput,
  StatusType,
  UpdateAgentCatalogBody,
  UpdateAgentLaunchConfigBody,
  UpdateArtifactBody,
  UpdateInboxItemBody,
  UpdateLaunchPreferenceBody,
  UpdateLaunchSessionDefaultsBody,
  UpdateMissionBody,
  UpdateObjectiveBody,
  UpdateOrganizationBody,
  UpdateProfileBody,
  UpdateProjectBody,
  UpdateProjectExecutionTargetBody,
  UpdateProjectResourceBody,
  UpdateProjectResourceSourceBody,
  UpdateProjectStatusBody,
  UpdateProjectTagBody,
  UpdateTerminalProfileBody,
  UpdateUserTokenBody,
  UpdateWebhookSubscriptionBody,
  UpdateWorkspaceBody,
  UpdateWorkspaceMemberRoleBody,
  UpdateWorktreeBranchAutomationBody,
  WorkspaceDto,
  WorkspaceExecutionTargetDto
} from '../../shared/contract.ts';
import { buildEverythingQueuedProjection } from '../components/everything-queued/everything-queued-model.ts';

import { api } from './api.ts';
import { clearAuthTokens } from './api-base.ts';
import { authClient, normalizeEmail } from './auth-client.ts';
import { getDesktopBridge } from './desktop-chrome.ts';
import {
  fetchMissionBranchesFromLocalTarget,
  fetchWorktreesFromLocalTarget,
  gatherCommitDiffOnLocalTarget,
  purgeMergedWorktreesOnLocalTarget,
  removeWorktreeOnLocalTarget,
  resolveClientBranchActionContext,
  resolvePrimaryResourceForTarget,
  runBranchActionOnLocalTarget
} from './local-target-branch.ts';
import {
  isLocalTargetCapabilityAvailable,
  useLocalTargetCapabilityAvailable
} from './local-target-client.ts';
import {
  isRemoteExecutionTargetSelected,
  useIsRemoteExecutionTargetForProject
} from './local-target-remote.ts';
import { persistActiveOrganizationId } from './org-preferences.ts';
export { keys } from './query-keys.ts';
import { keys } from './query-keys.ts';
export * from './queries/github.ts';
import {
  createReorderBoardColumnMutation,
  createReorderFutureObjectivesMutation,
  createReorderMyMissionsMutation
} from './queries/optimistic-updates.ts';
export type {
  ReorderBoardColumnVars,
  ReorderFutureObjectivesVars,
  ReorderMyMissionsVars
} from './queries/optimistic-updates.ts';
import {
  invalidateMissionEverhourQueries,
  invalidateNonEverhourQueries,
  invalidateProjectEverhourQueries
} from './query-invalidation.ts';

// Mutations still invalidate eagerly so the originating user sees their change
// instantly; the realtime feed later reconciles the scoped query keys it can map.
function invalidateAll(qc: QueryClient) {
  invalidateNonEverhourQueries(qc);
}

// ---- Queries -------------------------------------------------------------

export const useMeta = () => useQuery({ queryKey: keys.meta, queryFn: api.meta });

export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: api.getProfile });

export const useNotifications = () =>
  useQuery<NotificationDto[]>({ queryKey: keys.notifications, queryFn: api.listNotifications });

export const useNotificationPreferences = () =>
  useQuery({ queryKey: keys.notificationPreferences, queryFn: api.getNotificationPreferences });

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) =>
      api.markNotificationRead(id, revision),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.notifications })
  });
}

export function useDismissNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) =>
      api.dismissNotification(id, revision),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.notifications })
  });
}

export const useDefaultProject = () =>
  useQuery({ queryKey: keys.defaultProject, queryFn: api.getDefaultProject });

export function useSetDefaultProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => api.setDefaultProject(projectId),
    onSuccess: preference => {
      qc.setQueryData(keys.defaultProject, preference);
      void qc.invalidateQueries({ queryKey: keys.meta });
    }
  });
}

export function useClearDefaultProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.clearDefaultProject,
    onSuccess: preference => {
      qc.setQueryData(keys.defaultProject, preference);
      void qc.invalidateQueries({ queryKey: keys.meta });
    }
  });
}

/**
 * Live runner queue status for the sidebar runner box. Polls on a light
 * interval so the subtle status indicator stays current without a realtime
 * subscription.
 */
export const useRunnerStatus = (options?: { enabled?: boolean; refetchInterval?: number }) =>
  useQuery({
    queryKey: keys.runnerStatus,
    queryFn: api.getRunnerStatus,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 15_000
  });

/** Project-scoped Run Queue state. Poll while a queue is live so held/running rows stay current. */
export const useProjectRunQueues = (projectId: string) =>
  useQuery<ProjectRunQueuesDto>({
    queryKey: keys.runQueues(projectId),
    queryFn: () => api.getProjectRunQueues(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 10_000
  });

/** Read-only Inbox projection assembled from independently authorized project queue reads. */
export const useEverythingQueued = () => {
  const projects = useAllProjects('all');
  const workspaces = useAccessibleWorkspaces();
  const queueQueries = useQueries({
    queries: projects.data.map(project => ({
      queryKey: keys.runQueues(project.id),
      queryFn: () => api.getProjectRunQueues(project.id),
      enabled: !projects.isLoading,
      refetchInterval: 10_000
    }))
  });
  const data = buildEverythingQueuedProjection(
    projects.data.map((project, index) => ({
      project,
      workspaceName:
        workspaces.find(workspace => workspace.id === project.workspaceId)?.name ??
        'Unknown workspace',
      queues: queueQueries[index]?.data,
      readable: !queueQueries[index]?.isError
    }))
  );
  const queueLoading = queueQueries.some(query => query.isLoading);
  const queueErrors = queueQueries.filter(query => query.isError).length;

  return {
    data,
    isLoading: projects.isLoading || queueLoading,
    isError:
      !projects.isLoading &&
      ((projects.isError && projects.data.length === 0) ||
        (projects.data.length > 0 && queueErrors === projects.data.length)),
    hasPartialError:
      (projects.isError && projects.data.length > 0) ||
      (queueErrors > 0 && queueErrors < projects.data.length)
  };
};

function invalidateRunQueue(qc: QueryClient, projectId: string) {
  void qc.invalidateQueries({ queryKey: keys.runQueues(projectId) });
  void qc.invalidateQueries({ queryKey: keys.missions(projectId) });
  invalidateAll(qc);
}

export function useEnqueueRunQueueEntry(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    // Omitting `queueId` targets the objective's own mission queue, creating it
    // if the mission does not have one yet.
    mutationFn: (body: { objectiveId: string; queueId?: string; afterEntryId?: string }) =>
      api.enqueueRunQueueEntry(projectId, body),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

/**
 * Remove a queue entry. `force` also clears the objective's stuck execution
 * requests and resets a `launching` objective, which is the only way to
 * recover an entry wedged in flight.
 */
export function useRemoveRunQueueEntry(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { entryId: string; force?: boolean }) =>
      typeof input === 'string'
        ? api.deleteRunQueueEntry(input)
        : api.deleteRunQueueEntry(input.entryId, input.force ? { force: true } : {}),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

export function useUpdateRunQueue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      queueId,
      body
    }: {
      queueId: string;
      body: { paused?: boolean; name?: string };
    }) => api.updateRunQueue(queueId, body),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

export function useCreateRunQueue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { name: string; missionId?: string | null }) =>
      api.createRunQueue(projectId, typeof input === 'string' ? { name: input } : input),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

export function useDeleteRunQueue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, moveEntriesTo }: { queueId: string; moveEntriesTo?: string }) =>
      api.deleteRunQueue(queueId, moveEntriesTo ? { moveEntriesTo } : {}),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

/** Queue definition order is optimistic and restores the prior projection on rejection. */
export function useReorderProjectRunQueues(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedQueueIds: string[]) =>
      api.reorderProjectRunQueues(projectId, orderedQueueIds),
    onMutate: async orderedQueueIds => {
      await qc.cancelQueries({ queryKey: keys.runQueues(projectId) });
      const previous = qc.getQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId));
      if (previous) {
        qc.setQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId), {
          ...previous,
          queues: orderedQueueIds
            .map(id => previous.queues.find(queue => queue.id === id))
            .filter((queue): queue is NonNullable<typeof queue> => Boolean(queue))
            .map((queue, index) => ({ ...queue, position: index + 1 }))
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(keys.runQueues(projectId), context.previous);
    },
    onSettled: () => invalidateRunQueue(qc, projectId)
  });
}

/** Cross-queue entry moves update both sections optimistically and recover on rejected writes. */
export function useMoveRunQueueEntry(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      entryId,
      queueId,
      afterEntryId
    }: {
      entryId: string;
      queueId: string;
      afterEntryId?: string;
    }) => api.moveRunQueueEntry(entryId, { queueId, ...(afterEntryId ? { afterEntryId } : {}) }),
    onMutate: async ({ entryId, queueId, afterEntryId }) => {
      await qc.cancelQueries({ queryKey: keys.runQueues(projectId) });
      const previous = qc.getQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId));
      if (previous) {
        const entry = previous.queues
          .flatMap(queue => queue.entries)
          .find(item => item.id === entryId);
        if (entry) {
          qc.setQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId), {
            ...previous,
            queues: previous.queues.map(queue => {
              const withoutEntry = queue.entries.filter(item => item.id !== entryId);
              if (queue.id !== queueId) {
                return {
                  ...queue,
                  entries: withoutEntry.map((item, index) => ({ ...item, position: index + 1 }))
                };
              }
              const insertAt = afterEntryId
                ? Math.max(0, withoutEntry.findIndex(item => item.id === afterEntryId) + 1)
                : withoutEntry.length;
              const entries = [...withoutEntry];
              entries.splice(insertAt, 0, {
                ...entry,
                queueId,
                state: 'waiting',
                blockedReason: null
              });
              return {
                ...queue,
                entries: entries.map((item, index) => ({ ...item, position: index + 1 }))
              };
            })
          });
        }
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(keys.runQueues(projectId), context.previous);
    },
    onSettled: () => invalidateRunQueue(qc, projectId)
  });
}

/** Reordering is optimistic and restores the previous queue snapshot on a rejected write. */
export function useReorderRunQueue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, orderedEntryIds }: { queueId: string; orderedEntryIds: string[] }) =>
      api.reorderRunQueue(queueId, orderedEntryIds),
    onMutate: async ({ queueId, orderedEntryIds }) => {
      await qc.cancelQueries({ queryKey: keys.runQueues(projectId) });
      const previous = qc.getQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId));
      if (previous) {
        qc.setQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId), {
          ...previous,
          queues: previous.queues.map(queue =>
            queue.id !== queueId
              ? queue
              : {
                  ...queue,
                  entries: orderedEntryIds
                    .map(id => queue.entries.find(entry => entry.id === id))
                    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
                    .map((entry, index) => ({ ...entry, position: index + 1 }))
                }
          )
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(keys.runQueues(projectId), context.previous);
    },
    onSettled: () => invalidateRunQueue(qc, projectId)
  });
}

/**
 * Local persistent-runner service state via the desktop bridge (`ovld runner
 * service status`). Resolves to null in a plain browser or when the bridge call
 * fails, so consumers can quietly fall back to queue-only signals.
 */
export const useRunnerServiceStatus = (options?: { enabled?: boolean }) => {
  const runnerService = getDesktopBridge()?.runnerService;
  return useQuery({
    queryKey: keys.runnerServiceStatus,
    queryFn: async () => {
      if (!runnerService) return null;
      const result = await runnerService.getStatus();
      return result.ok ? (result.status ?? null) : null;
    },
    enabled: (options?.enabled ?? true) && Boolean(runnerService),
    // Each read spawns a CLI process; poll gently and reuse across consumers.
    refetchInterval: 60_000,
    staleTime: 30_000
  });
};

export const useUserTokens = () =>
  useQuery({ queryKey: keys.userTokens, queryFn: api.listUserTokens });

export const useWebhookSubscriptions = (workspaceId: string) =>
  useQuery({
    queryKey: keys.webhookSubscriptions(workspaceId),
    queryFn: () => api.listWebhookSubscriptions(workspaceId),
    enabled: Boolean(workspaceId)
  });

export const useWebhookDeliveries = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.webhookDeliveries(id),
    queryFn: () => api.listWebhookDeliveries(id),
    enabled
  });

export const useOrganizations = () =>
  useQuery({ queryKey: keys.organizations, queryFn: api.listOrganizations });

export const useOrganizationAdmins = (id: string | null) =>
  useQuery({
    queryKey: keys.organizationAdmins(id ?? '__none__'),
    queryFn: () => api.listOrganizationAdmins(id ?? ''),
    enabled: Boolean(id)
  });

export const useWorkspaceExecutionTargets = (workspaceId: string) =>
  useQuery<WorkspaceExecutionTargetDto[]>({
    queryKey: keys.workspaceExecutionTargets(workspaceId),
    queryFn: () => api.getWorkspaceExecutionTargets(workspaceId),
    staleTime: 30_000
  });

export function useDeleteWorkspaceExecutionTarget(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (executionTargetId: string) =>
      api.deleteWorkspaceExecutionTarget(workspaceId, executionTargetId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspaceExecutionTargets(workspaceId) });
      invalidateNonEverhourQueries(qc);
    }
  });
}

export function useRegisterWorkspaceExecutionTarget(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label?: string } = {}) =>
      api.registerWorkspaceExecutionTarget(workspaceId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspaceExecutionTargets(workspaceId) });
      invalidateNonEverhourQueries(qc);
    }
  });
}

export function useRenameWorkspaceExecutionTarget(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ executionTargetId, label }: { executionTargetId: string; label: string }) =>
      api.updateWorkspaceExecutionTarget(workspaceId, executionTargetId, { label }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspaceExecutionTargets(workspaceId) });
      invalidateNonEverhourQueries(qc);
    }
  });
}

export function useUpdateWorkspaceExecutionTargetStatus(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      executionTargetId,
      status
    }: {
      executionTargetId: string;
      status: 'active' | 'disabled';
    }) => api.updateWorkspaceExecutionTarget(workspaceId, executionTargetId, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspaceExecutionTargets(workspaceId) });
      invalidateNonEverhourQueries(qc);
    }
  });
}

export const useAccessibleWorkspaces = () => {
  const meta = useMeta();
  return meta.data?.workspaces ?? [];
};

export const useWorkspaces = () =>
  useQuery({ queryKey: keys.workspaces, queryFn: api.listWorkspaces });

export const useWorkspaceMembers = (id: string | null) =>
  useQuery({
    queryKey: keys.workspaceMembers(id ?? '__none__'),
    queryFn: () => api.listWorkspaceMembers(id ?? ''),
    enabled: Boolean(id)
  });

export const useWorkspaceInvitations = (id: string | null) =>
  useQuery({
    queryKey: keys.workspaceInvitations(id ?? '__none__'),
    queryFn: () => api.listWorkspaceInvitations(id ?? ''),
    enabled: Boolean(id)
  });

export const useProjects = (workspaceId?: string, lifecycle: ProjectListLifecycle = 'active') => {
  return useQuery({
    queryKey: keys.projects(workspaceId, lifecycle),
    queryFn: () => {
      if (!workspaceId) return Promise.resolve([]);
      return api.listProjectsForWorkspace(workspaceId, lifecycle);
    },
    enabled: Boolean(workspaceId)
  });
};

/**
 * Projects across every accessible workspace of the active organization
 * (coo:324), in `meta.workspaces` order. New-mission surfaces (new mission
 * modal, quick task bar) use this so every workspace the caller is a member
 * of is offered equally; per-workspace cache entries are shared with
 * `useProjects(workspaceId)` via the same query keys.
 */
export const useAllProjects = (lifecycle: ProjectListLifecycle = 'active') => {
  const meta = useMeta();
  const workspaces = meta.data?.workspaces ?? [];

  const combined = useQueries({
    queries: workspaces.map(workspace => ({
      queryKey: keys.projects(workspace.id, lifecycle),
      queryFn: () => api.listProjectsForWorkspace(workspace.id, lifecycle)
    })),
    combine: results => ({
      projects: results.flatMap(result => result.data ?? []),
      anyLoading: results.some(result => result.isLoading),
      anyError: results.some(result => result.isError)
    })
  });

  return {
    data: combined.projects,
    isLoading: meta.isLoading || combined.anyLoading,
    isPending: meta.isPending || combined.anyLoading,
    isError: meta.isError || combined.anyError
  };
};

export const useProject = (id: string) =>
  useQuery({ queryKey: keys.project(id), queryFn: () => api.getProject(id) });

export const useProjectStatuses = (projectId: string) =>
  useQuery({
    queryKey: keys.projectStatuses(projectId),
    queryFn: () => api.listProjectStatuses(projectId),
    enabled: Boolean(projectId)
  });

export const useWorkspaceProjectStatuses = (workspaceId: string) =>
  useQuery({
    queryKey: keys.workspaceProjectStatuses(workspaceId),
    queryFn: () => api.listWorkspaceProjectStatuses(workspaceId),
    enabled: Boolean(workspaceId)
  });

// Project-scoped queries are routinely mounted before a project is chosen (the
// quick-task bar, the new-mission modal). Without this guard they request
// `/api/projects//resources` and every sibling project route with an empty id,
// which the backend answers 404 — a burst of red herrings in the request log
// that looks like a launch failure and is only an unselected project.
export const useProjectResources = (id: string) =>
  useQuery({
    queryKey: keys.projectResources(id),
    queryFn: () => api.listProjectResources(id),
    enabled: Boolean(id)
  });

export const useProjectTags = (id: string | null) =>
  useQuery({
    queryKey: keys.projectTags(id ?? 'none'),
    queryFn: () => api.listProjectTags(id as string),
    enabled: Boolean(id)
  });

export const useProjectRepository = (
  id: string,
  executionTargetId: string | null,
  resourceKey?: string | null
) =>
  useQuery({
    queryKey: keys.projectRepository(id, executionTargetId, resourceKey ?? null),
    queryFn: () => api.getProjectRepository(id, executionTargetId, resourceKey ?? null),
    enabled: Boolean(id)
  });

export const useMissions = (projectId: string) =>
  useQuery({ queryKey: keys.missions(projectId), queryFn: () => api.listMissions(projectId) });

// The active operator's assigned missions across the selected workspace. The
// realtime SSE feed invalidates this for mission/objective workflow changes, and
// the reorder mutation updates it optimistically.
export const useWorkspaceMyMissions = () =>
  useQuery({ queryKey: keys.myMissions, queryFn: () => api.listWorkspaceMyMissions() });

export const useMission = (id: string, options: { refetchBranchState?: boolean } = {}) =>
  useQuery({
    queryKey: keys.mission(id),
    queryFn: () => api.getMission(id),
    // Mission branch metadata is derived from live git state at request time, not
    // persisted database rows, so the SSE feed cannot observe external git
    // changes. Poll only for open detail panels that opt into branch freshness.
    refetchInterval: options.refetchBranchState ? 5_000 : false
  });

// Available branches for the mission's branch selector. Only fetched when the
// selector is opened (callers pass `enabled`) so we don't shell git on every
// mission open.
export const useMissionBranches = ({
  missionId,
  projectId,
  current,
  enabled
}: {
  missionId: string;
  projectId: string;
  current: string | null;
  enabled: boolean;
}) => {
  const localTargetAvailable = useLocalTargetCapabilityAvailable();
  const executionTarget = useProjectExecutionTarget(projectId);
  const resources = useProjectResources(projectId);
  const selectedExecutionTargetId = executionTarget.data?.selectedExecutionTargetId ?? null;
  const primaryResource = resolvePrimaryResourceForTarget({
    resources: resources.data ?? [],
    executionTargetId: selectedExecutionTargetId
  });

  return useQuery({
    queryKey: keys.missionBranches(missionId),
    queryFn: async () => {
      if (localTargetAvailable && primaryResource) {
        return fetchMissionBranchesFromLocalTarget({ resource: primaryResource, current });
      }
      return api.listMissionBranches(missionId);
    },
    enabled: enabled && (!localTargetAvailable || Boolean(primaryResource)),
    staleTime: 30_000
  });
};

export const useWorktrees = () => {
  const localTargetAvailable = useLocalTargetCapabilityAvailable();
  const projects = useAllProjects();

  return useQuery({
    queryKey: keys.worktrees,
    queryFn: async () => {
      if (localTargetAvailable) {
        const projectList = projects.data ?? [];
        const resourceEntries = await Promise.all(
          projectList.map(
            async project => [project.id, await api.listProjectResources(project.id)] as const
          )
        );
        return fetchWorktreesFromLocalTarget({
          projects: projectList,
          projectResources: new Map(resourceEntries)
        });
      }
      return api.listWorktrees();
    },
    enabled: !localTargetAvailable || Boolean(projects.data),
    staleTime: 30_000
  });
};

// The realtime SSE feed invalidates this query for mission_event changes written
// by the CLI/agent in another process, so the activity feed updates without
// bespoke wiring here.
export const useMissionEvents = (id: string) =>
  useQuery({ queryKey: keys.missionEvents(id), queryFn: () => api.listMissionEvents(id) });

/** Delivery records are fetched for the Artifacts section delivery cards. */
export const useMissionDeliveries = (id: string, enabled: boolean) =>
  useQuery<DeliveryDto[]>({
    queryKey: keys.missionDeliveries(id),
    queryFn: () => api.listMissionDeliveries(id),
    enabled
  });

/**
 * Answerable agent-session requests for one mission.
 *
 * Polled in addition to realtime invalidation: an open permission has a short, presence-sized
 * decision window, and a card that only refreshes when an SSE frame happens to arrive can keep
 * offering buttons for a decision the server already released to the terminal.
 */
export const useMissionAgentRequests = (id: string) =>
  useQuery({
    queryKey: keys.missionAgentRequests(id),
    queryFn: () => api.listAgentRequests(id).then(result => result.requests),
    refetchInterval: 5_000
  });

export const useMissionAgentSessionInputs = (id: string) =>
  useQuery({
    queryKey: keys.missionAgentSessionInputs(id),
    queryFn: () => api.listAgentSessionInputs(id),
    refetchInterval: 5_000
  });

/**
 * Answer a request under revision CAS. A `resolved: false` response is not an error — it means
 * the decision was already made elsewhere, and the caller must show that instead of success.
 * A 409 / `agent_request_conflict` is the same lost-race outcome when the card's revision was
 * stale; cards should map it to the lost-race copy rather than the raw error string.
 */
export function useResolveAgentRequest(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      resolution,
      expectedRevision
    }: {
      requestId: string;
      resolution: Record<string, unknown>;
      expectedRevision: number;
    }) => api.resolveAgentRequest(requestId, { resolution, expectedRevision }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.missionAgentRequests(missionId) })
  });
}

/** Hand a request back to the native terminal prompt without answering it. */
export function useReleaseAgentRequest(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => api.releaseAgentRequest(requestId),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.missionAgentRequests(missionId) })
  });
}

/** Cancel a queued instruction. Only meaningful while it has not been emitted. */
export function useCancelAgentSessionInput(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inputId: string) => api.cancelAgentSessionInput(inputId),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.missionAgentSessionInputs(missionId) })
  });
}

export const useMissionArtifacts = (id: string) =>
  useQuery({ queryKey: keys.missionArtifacts(id), queryFn: () => api.listMissionArtifacts(id) });

export function useUpdateMissionArtifact(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ artifactId, body }: { artifactId: string; body: UpdateArtifactBody }) =>
      api.updateMissionArtifact(missionId, artifactId, body),
    onSuccess: artifact => {
      qc.setQueryData<import('../../shared/contract.ts').ArtifactDto[]>(
        keys.missionArtifacts(missionId),
        current => current?.map(item => (item.id === artifact.id ? artifact : item))
      );
    }
  });
}

export const useMissionSharedContext = (id: string) =>
  useQuery({
    queryKey: keys.missionSharedContext(id),
    queryFn: () => api.listMissionSharedContext(id)
  });

export function useUpsertMissionSharedContext(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: import('../../shared/contract.ts').UpsertSharedContextBody) =>
      api.upsertMissionSharedContext(missionId, body),
    onSuccess: entry => {
      qc.setQueryData<import('../../shared/contract.ts').SharedContextEntryDto[]>(
        keys.missionSharedContext(missionId),
        current => {
          if (!current) return [entry];
          const without = current.filter(item => item.id !== entry.id && item.key !== entry.key);
          return [entry, ...without];
        }
      );
    }
  });
}

// Change rationale writes currently arrive through broad fallback invalidation
// unless a future feed row carries a more specific file-change entity type.
export const useMissionFileChanges = (id: string) =>
  useQuery({
    queryKey: keys.missionFileChanges(id),
    queryFn: () => api.listMissionFileChanges(id)
  });

// ---- Mutations -----------------------------------------------------------

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileBody) => api.updateProfile(body),
    onSuccess: data => {
      qc.setQueryData(keys.profile, data);
      // The sidebar identity reads from the workspace meta, so refresh it too.
      void qc.invalidateQueries({ queryKey: keys.meta });
    }
  });
}

/**
 * Change the account email through the Auth surface. Email is the primary
 * account identifier, so this updates the Better Auth account email directly;
 * the auth→profiles bridge then mirrors the new email into `profiles.email`.
 */
export function useChangeEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rawEmail: string) => {
      const email = normalizeEmail(rawEmail);
      const reemailed = await authClient.changeEmail({ newEmail: email });
      if (reemailed.error) {
        throw new Error(reemailed.error.message ?? 'Failed to update email.');
      }
      return email;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.profile });
      void qc.invalidateQueries({ queryKey: keys.meta });
    }
  });
}

/** Change the account password through the Auth surface (requires the current password). */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      const result = await authClient.changePassword({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true
      });
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to update password.');
      }
    }
  });
}

/**
 * Permanently delete the signed-in account through the Auth surface. The
 * server cascades workspace memberships, tokens, and avatar images before
 * removing the underlying auth user (see backend/account-deletion.ts), then
 * clears the session cookie itself — this only needs to drop local tokens
 * once the call succeeds so the next render sees a signed-out state.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (password: string) => {
      const result = await authClient.deleteUser({ password });
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to delete account.');
      }
    },
    onSuccess: async () => {
      await clearAuthTokens();
    }
  });
}

/**
 * Upload an image to the `user-images` bucket via the core upload service and
 * set it as the operator's avatar in one step. Returns the updated profile.
 */
export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const stored = await api.uploadImage('user-images', file);
      return api.updateProfile({ avatarUrl: stored.url });
    },
    onSuccess: data => {
      qc.setQueryData(keys.profile, data);
      void qc.invalidateQueries({ queryKey: keys.meta });
    }
  });
}

/**
 * Upload an image to the `organization-images` bucket and set it as the given
 * organization's logo. Org-admin-only on the server side.
 */
export function useUploadOrganizationLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ organizationId, file }: { organizationId: string; file: File }) => {
      const stored = await api.uploadImage('organization-images', file);
      return api.updateOrganization(organizationId, { logoUrl: stored.url });
    },
    onSuccess: () => invalidateAll(qc)
  });
}

export function useCreateOrganizationOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOrganizationOnboardingBody) => api.createOrganizationOnboarding(body),
    onSuccess: data => {
      if (data.organization) persistActiveOrganizationId(data.organization.id);
      invalidateAll(qc);
    }
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOrganizationBody }) =>
      api.updateOrganization(id, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useActivateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (organizationId: string) => {
      persistActiveOrganizationId(organizationId);
      const workspaces = await api.listWorkspaces();
      const hasWorkspace = workspaces.some(
        workspace => workspace.organizationId === organizationId
      );
      if (!hasWorkspace) throw new Error('No workspace found in this organization');
      return workspaces;
    },
    onSuccess: () => {
      invalidateAll(qc);
    }
  });
}

export function useAddOrganizationAdmin(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddOrganizationAdminBody) => api.addOrganizationAdmin(organizationId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.organizationAdmins(organizationId) });
      invalidateAll(qc);
    }
  });
}

export function useRemoveOrganizationAdmin(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeOrganizationAdmin(organizationId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.organizationAdmins(organizationId) });
      invalidateAll(qc);
    }
  });
}

export function useCreateUserToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserTokenBody) => api.createUserToken(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.userTokens })
  });
}

export function useRenameUserToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserTokenBody }) =>
      api.renameUserToken(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.userTokens })
  });
}

export function useRevokeUserToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeUserToken(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.userTokens })
  });
}

export function useDeleteRevokedUserToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRevokedUserToken(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.userTokens })
  });
}

export function useCreateWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWebhookSubscriptionBody) => api.createWebhookSubscription(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  });
}

export function useUpdateWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWebhookSubscriptionBody }) =>
      api.updateWebhookSubscription(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  });
}

export function useDeleteWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWebhookSubscription(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  });
}

export function useRotateWebhookSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rotateWebhookSecret(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  });
}

export function useTestWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.testWebhookSubscription(id),
    onSuccess: (_result, id) => void qc.invalidateQueries({ queryKey: keys.webhookDeliveries(id) })
  });
}

export function useRedeliverWebhookDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, outboxId }: { id: string; outboxId: string }) =>
      api.redeliverWebhookDelivery(id, outboxId),
    onSuccess: (_result, { id }) =>
      void qc.invalidateQueries({ queryKey: keys.webhookDeliveries(id) })
  });
}

export function useUpdateWorktreeBranchAutomation(workspaceId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWorktreeBranchAutomationBody) =>
      api.updateWorktreeBranchAutomation(body, workspaceId),
    onSuccess: data => {
      qc.setQueryData(keys.launchSettings(workspaceId), data);
    }
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkspaceBody) => api.createWorkspace(body),
    onSuccess: data => {
      invalidateAll(qc);
    }
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWorkspaceBody }) =>
      api.updateWorkspace(id, body),
    // Renaming the active workspace also changes the sidebar identity (meta).
    onSuccess: () => invalidateAll(qc)
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkspace(id),
    onSuccess: () => {
      invalidateAll(qc);
    }
  });
}

export function useInviteWorkspaceMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InviteWorkspaceMemberBody) => api.inviteWorkspaceMember(workspaceId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaceInvitations(workspaceId) })
  });
}

export function useRevokeWorkspaceInvitation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => api.revokeWorkspaceInvitation(workspaceId, invitationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaceInvitations(workspaceId) })
  });
}

export function useRemoveWorkspaceMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceUserId: string) =>
      api.removeWorkspaceMember(workspaceId, workspaceUserId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaceMembers(workspaceId) })
  });
}

export function useUpdateWorkspaceMemberRole(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceUserId,
      body
    }: {
      workspaceUserId: string;
      body: UpdateWorkspaceMemberRoleBody;
    }) => api.updateWorkspaceMemberRole(workspaceId, workspaceUserId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaceMembers(workspaceId) })
  });
}

export function useAcceptWorkspaceInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AcceptWorkspaceInvitationBody) => api.acceptWorkspaceInvitation(body),
    // Accepting grants a brand-new workspace membership, so the whole cache is stale.
    onSuccess: data => {
      invalidateAll(qc);
    }
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectBody) => api.createProject(body),
    onSuccess: () => invalidateAll(qc)
  });
}

function patchProjectInQueryCaches({
  qc,
  updated
}: {
  qc: QueryClient;
  updated: ProjectDto;
}): void {
  qc.setQueryData(keys.project(updated.id), updated);
  qc.setQueryData(keys.projects(updated.workspaceId), (prev: ProjectDto[] | undefined) =>
    prev?.map(project => (project.id === updated.id ? updated : project))
  );
  qc.setQueryData(keys.projects(), (prev: ProjectDto[] | undefined) =>
    prev?.map(project => (project.id === updated.id ? updated : project))
  );
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProjectBody) => api.updateProject(id, body),
    onSuccess: updated => {
      patchProjectInQueryCaches({ qc, updated });
      invalidateAll(qc);
    }
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useReorderProjects(workspaceId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (body: ReorderProjectsBody) => api.reorderProjects(body),
    onSuccess: data => {
      qc.setQueryData(keys.projects(workspaceId), data);
      void qc.invalidateQueries({ queryKey: keys.projects(workspaceId) });
      invalidateAll(qc);
    }
  });
}

export function useCreateProjectStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectStatusBody) => api.createProjectStatus(projectId, body),
    onSuccess: data => {
      qc.setQueryData(keys.projectStatuses(projectId), (prev: ProjectStatusDto[] | undefined) =>
        prev ? [...prev, data].sort((a, b) => a.position - b.position) : [data]
      );
      void qc.invalidateQueries({ queryKey: keys.projectStatuses(projectId) });
    }
  });
}

export function useUpdateProjectStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ statusId, body }: { statusId: string; body: UpdateProjectStatusBody }) =>
      api.updateProjectStatus(projectId, statusId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.projectStatuses(projectId) });
      void qc.invalidateQueries({ queryKey: keys.myMissions });
    }
  });
}

export function useDeleteProjectStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (statusId: string) => api.deleteProjectStatus(projectId, statusId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.projectStatuses(projectId) });
      void qc.invalidateQueries({ queryKey: keys.myMissions });
    }
  });
}

export function useReorderProjectStatuses(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReorderProjectStatusesBody) => api.reorderProjectStatuses(projectId, body),
    onSuccess: data => {
      qc.setQueryData(keys.projectStatuses(projectId), data);
      void qc.invalidateQueries({ queryKey: keys.projectStatuses(projectId) });
      void qc.invalidateQueries({ queryKey: keys.myMissions });
    }
  });
}

export function useCreateProjectTag(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectTagBody) => api.createProjectTag(projectId, body),
    onSuccess: data => {
      qc.setQueryData(keys.projectTags(projectId), (prev: ProjectTagDto[] | undefined) =>
        prev ? [...prev, data].sort((a, b) => a.label.localeCompare(b.label)) : [data]
      );
      void qc.invalidateQueries({ queryKey: keys.projectTags(projectId) });
    }
  });
}

export function useCreateProjectResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectResourceBody) => api.createProjectResource(projectId, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useUpdateProjectResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceId, body }: { resourceId: string; body: UpdateProjectResourceBody }) =>
      api.updateProjectResource(projectId, resourceId, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useDeleteProjectResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) => api.deleteProjectResource(projectId, resourceId),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useDeleteProjectResourceSource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceId, sourceId }: { resourceId: string; sourceId: string }) =>
      api.deleteProjectResourceSource(projectId, resourceId, sourceId),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useUpdateProjectResourceSource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      resourceId,
      sourceId,
      body
    }: {
      resourceId: string;
      sourceId: string;
      body: UpdateProjectResourceSourceBody;
    }) => api.updateProjectResourceSource(projectId, resourceId, sourceId, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useUpdateProjectTag(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tagId, body }: { tagId: string; body: UpdateProjectTagBody }) =>
      api.updateProjectTag(projectId, tagId, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useDeleteProjectTag(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) => api.deleteProjectTag(projectId, tagId),
    onSuccess: () => invalidateAll(qc)
  });
}

/** Restores an archived project. Takes the project id per call so list rows can share one hook. */
export function useUnarchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.updateProject(id, { status: 'active' }),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useCreateMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMissionBody) => api.createMission(body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useInboxItems() {
  return useQuery<InboxItemDto[]>({ queryKey: keys.inbox, queryFn: api.listInboxItems });
}

/**
 * Cross-workspace objective activity for the Inbox feed. Freshness comes from the
 * realtime change link invalidating `keys.activityFeed`, not from polling — the
 * `refetchOnWindowFocus` default is the only fallback for a dropped stream.
 */
export function useActivityFeed() {
  return useQuery<ActivityFeedDto>({
    queryKey: keys.activityFeed,
    queryFn: api.getActivityFeed
  });
}

export function useCreateInboxItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInboxItemBody) => api.createInboxItem(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.inbox })
  });
}

export function useUpdateInboxItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateInboxItemBody }) =>
      api.updateInboxItem(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.inbox })
  });
}

export function useDeleteInboxItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteInboxItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.inbox })
  });
}

export function usePromoteInboxItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      api.promoteInboxItem(id, projectId),
    onSuccess: mission => {
      // Seed the mission cache so sticky Inbox cards can keep editing/running
      // without waiting for a follow-up fetch.
      qc.setQueryData(keys.mission(mission.id), mission);
      invalidateAll(qc);
    }
  });
}

export function useUpdateMission(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMissionBody) => api.updateMission(id, body),
    onSuccess: data => {
      qc.setQueryData(keys.mission(id), data);
      invalidateAll(qc);
    }
  });
}

export function useMissionSchedule(missionId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.missionSchedule(missionId),
    queryFn: () => api.getMissionSchedule(missionId),
    enabled: options?.enabled ?? true
  });
}

export function useUpsertMissionSchedule(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ScheduleInput) => api.upsertMissionSchedule(missionId, body),
    onSuccess: data => {
      qc.setQueryData(keys.missionSchedule(missionId), data);
      void qc.invalidateQueries({ queryKey: keys.mission(missionId) });
      invalidateAll(qc);
    }
  });
}

export function useClearMissionSchedule(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearMissionSchedule(missionId),
    onSuccess: () => {
      qc.setQueryData(keys.missionSchedule(missionId), {
        dueDatetime: null,
        schedule: null
      } satisfies MissionScheduleDto);
      void qc.invalidateQueries({ queryKey: keys.mission(missionId) });
      invalidateAll(qc);
    }
  });
}

export function usePreviewScheduleDueDatetime() {
  return useMutation({
    mutationFn: (body: PreviewScheduleBody) => api.previewMissionSchedule(body)
  });
}

export function useDeleteMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMission(id),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useSetMissionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ missionId, statusId }: { missionId: string; statusId: string }) =>
      api.updateMission(missionId, { statusId }),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useGenerateMissionTitle(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateMissionTitle(id),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useGenerateCommitMessage(mission: MissionDetailDto) {
  return useMutation({
    mutationFn: async () => {
      if (await isLocalTargetCapabilityAvailable()) {
        const resources = await api.listProjectResources(mission.projectId);
        const executionTarget = await api.getProjectExecutionTarget(mission.projectId);
        const context = await resolveClientBranchActionContext({
          mission,
          resources,
          executionTargetId: executionTarget.selectedExecutionTargetId
        });
        if (!context) {
          throw new Error('This mission has no prepared branch worktree on this device.');
        }
        const diff = await gatherCommitDiffOnLocalTarget({ worktreePath: context.worktreePath });
        return api.generateCommitMessage(mission.id, { diff });
      }
      return api.generateCommitMessage(mission.id);
    }
  });
}

export function useBranchAction(mission: MissionDetailDto) {
  const qc = useQueryClient();
  const isRemoteTarget = useIsRemoteExecutionTargetForProject(mission.projectId);
  return useMutation({
    mutationFn: async (body: BranchActionBody) => {
      if (isRemoteTarget) {
        return api.branchAction(mission.id, body);
      }
      if (await isLocalTargetCapabilityAvailable()) {
        const resources = await api.listProjectResources(mission.projectId);
        const executionTarget = await api.getProjectExecutionTarget(mission.projectId);
        const context = await resolveClientBranchActionContext({
          mission,
          resources,
          executionTargetId: executionTarget.selectedExecutionTargetId
        });
        if (!context) {
          throw new Error('This mission has no prepared branch worktree on this device.');
        }
        const summary = await runBranchActionOnLocalTarget({ context, body });
        return api.branchAction(mission.id, {
          action: body.action,
          confirmBusy: body.confirmBusy,
          message: body.message,
          clientExecuted: true,
          summary
        });
      }
      return api.branchAction(mission.id, body);
    },
    onSuccess: () => invalidateAll(qc)
  });
}

export function useRemoveWorktree() {
  const qc = useQueryClient();
  const localTargetAvailable = useLocalTargetCapabilityAvailable();
  const projects = useAllProjects();

  return useMutation({
    mutationFn: async (body: RemoveWorktreeBody) => {
      const projectList = projects.data ?? [];
      const resourceEntries = await Promise.all(
        projectList.map(
          async project => [project.id, await api.listProjectResources(project.id)] as const
        )
      );
      const worktrees = localTargetAvailable
        ? await fetchWorktreesFromLocalTarget({
            projects: projectList,
            projectResources: new Map(resourceEntries)
          })
        : [];
      const match = worktrees.find(worktree => worktree.path === body.path);
      const projectId = body.projectId ?? match?.projectId;
      const isRemoteTarget = projectId
        ? isRemoteExecutionTargetSelected({
            localExecutionTargetId: (await api.getLaunchSettings()).executionTargetId,
            selectedExecutionTargetId: (await api.getProjectExecutionTarget(projectId))
              .selectedExecutionTargetId
          })
        : false;

      if (isRemoteTarget && projectId) {
        const resources = await api.listProjectResources(projectId);
        const executionTarget = await api.getProjectExecutionTarget(projectId);
        const primary = resolvePrimaryResourceForTarget({
          resources,
          executionTargetId: executionTarget.selectedExecutionTargetId
        });
        return api.removeWorktree({
          ...body,
          projectId,
          executionTargetId: executionTarget.selectedExecutionTargetId,
          primaryRepoPath: primary?.path ?? body.primaryRepoPath
        });
      }

      if (localTargetAvailable) {
        const resources = match ? await api.listProjectResources(match.projectId) : [];
        const primary = resolvePrimaryResourceForTarget({
          resources,
          executionTargetId: null
        });
        return removeWorktreeOnLocalTarget({
          body: { ...body, primaryRepoPath: primary?.path ?? body.primaryRepoPath },
          projects: projectList,
          projectResources: new Map(resourceEntries)
        });
      }
      return api.removeWorktree(body);
    },
    onSuccess: result => {
      qc.setQueryData(keys.worktrees, result.worktrees);
      void qc.invalidateQueries({ queryKey: keys.worktrees });
    }
  });
}

export function usePurgeMergedWorktrees() {
  const qc = useQueryClient();
  const localTargetAvailable = useLocalTargetCapabilityAvailable();
  const projects = useAllProjects();

  return useMutation({
    mutationFn: async () => {
      const projectList = projects.data ?? [];
      const launchSettings = await api.getLaunchSettings();
      const remoteProjects = (
        await Promise.all(
          projectList.map(async project => {
            const executionTarget = await api.getProjectExecutionTarget(project.id);
            const isRemote = isRemoteExecutionTargetSelected({
              localExecutionTargetId: launchSettings.executionTargetId,
              selectedExecutionTargetId: executionTarget.selectedExecutionTargetId
            });
            if (!isRemote) return null;
            const resources = await api.listProjectResources(project.id);
            const primary = resolvePrimaryResourceForTarget({
              resources,
              executionTargetId: executionTarget.selectedExecutionTargetId
            });
            if (!primary?.path) return null;
            return {
              projectId: project.id,
              executionTargetId: executionTarget.selectedExecutionTargetId,
              primaryRepoPath: primary.path
            };
          })
        )
      ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      if (remoteProjects.length > 0) {
        for (const project of remoteProjects) {
          await api.purgeMergedWorktrees(project);
        }
        return { removed: [], skipped: [], worktrees: [] };
      }

      if (localTargetAvailable) {
        const resourceEntries = await Promise.all(
          projectList.map(
            async project => [project.id, await api.listProjectResources(project.id)] as const
          )
        );
        return purgeMergedWorktreesOnLocalTarget({
          projects: projectList,
          projectResources: new Map(resourceEntries)
        });
      }
      return api.purgeMergedWorktrees();
    },
    onSuccess: result => {
      qc.setQueryData(keys.worktrees, result.worktrees);
      void qc.invalidateQueries({ queryKey: keys.worktrees });
    }
  });
}

/**
 * Reorders a board column with an optimistic cache update: the new order/status
 * shows instantly and is reverted only if the server rejects the change. The
 * realtime SSE feed reconciles the cache with server truth on success.
 */
export function useReorderBoardColumn() {
  const qc = useQueryClient();
  return useMutation(createReorderBoardColumnMutation(qc));
}

/**
 * Reorders one My Missions status column with an optimistic cache update. Within-
 * column drags only move the personal slot; a cross-column drag also flips the
 * moved mission's status. On error (e.g. a status the workspace lacks) the caller
 * reverts and surfaces the typed alert; here we just roll the cache back.
 */
export function useReorderMyMissions() {
  const qc = useQueryClient();
  return useMutation(createReorderMyMissionsMutation(qc));
}

export function useCreateObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateObjectiveBody) => api.createObjective(body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useUpdateObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateObjectiveBody }) =>
      api.updateObjective(id, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useDeleteObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteObjective(id),
    onSuccess: () => invalidateAll(qc)
  });
}

// ---- Objective attachments -----------------------------------------------

export const useObjectiveAttachments = (
  objectiveId: string,
  { enabled = true }: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: keys.objectiveAttachments(objectiveId),
    queryFn: () => api.listObjectiveAttachments(objectiveId),
    enabled
  });

export function useUploadObjectiveAttachment(objectiveId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadObjectiveAttachment(objectiveId, file),
    onSuccess: attachment => {
      qc.setQueryData<ObjectiveAttachmentDto[]>(keys.objectiveAttachments(objectiveId), prev =>
        prev ? [...prev, attachment] : [attachment]
      );
      void qc.invalidateQueries({ queryKey: keys.objectiveAttachments(objectiveId) });
    }
  });
}

export function useDeleteObjectiveAttachment(objectiveId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => api.deleteObjectiveAttachment(objectiveId, attachmentId),
    onSuccess: remaining => {
      qc.setQueryData(keys.objectiveAttachments(objectiveId), remaining);
      void qc.invalidateQueries({ queryKey: keys.objectiveAttachments(objectiveId) });
    }
  });
}

/**
 * Reorders a mission's future objectives with an optimistic cache update: the new
 * order shows instantly and is reverted only if the server rejects it. The
 * realtime SSE feed reconciles the cache with server truth on success.
 */
export function useReorderFutureObjectives() {
  const qc = useQueryClient();
  return useMutation(createReorderFutureObjectivesMutation(qc));
}

// ---- Agent launch ----------------------------------------------------------

/**
 * A workspace's agent/model catalog. Pass a `workspaceId` to read the catalog
 * of any workspace the caller is a member of (workspace-equal surfaces such as
 * the workspace settings Models page or a cross-workspace project chooser);
 * omit it for the active workspace.
 */
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

// ---- Everhour integration ------------------------------------------------

/** Caller's Everhour connection state. Used to gate all Everhour UI. */
export const useEverhourIntegration = () =>
  useQuery({ queryKey: keys.everhourIntegration, queryFn: () => api.getEverhourIntegration() });

export function useSetEverhourApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => api.setEverhourApiKey(apiKey),
    onSuccess: data => {
      qc.setQueryData(keys.everhourIntegration, data);
      invalidateMissionEverhourQueries(qc);
      invalidateProjectEverhourQueries(qc);
    }
  });
}

export function useClearEverhourApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearEverhourApiKey(),
    onSuccess: data => {
      qc.setQueryData(keys.everhourIntegration, data);
      invalidateMissionEverhourQueries(qc);
      invalidateProjectEverhourQueries(qc);
    }
  });
}

export function useLinkProjectEverhour(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkProjectEverhourBody) => api.linkProjectEverhour(projectId, body),
    onSuccess: data => {
      qc.setQueryData(keys.projectEverhourLink(projectId), data);
      invalidateMissionEverhourQueries(qc);
      invalidateProjectEverhourQueries(qc);
    }
  });
}

export const useProjectEverhourLink = (projectId: string, options: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: keys.projectEverhourLink(projectId),
    queryFn: () => api.getProjectEverhourLink(projectId),
    enabled: options.enabled ?? true
  });

/**
 * Everhour state for one project's fixed `general` task. Only enabled once we
 * know the acting user is connected. Polls while the caller opts in (e.g. a
 * running timer) to keep elapsed time roughly fresh.
 */
export const useProjectEverhour = (
  projectId: string,
  options: { enabled?: boolean; poll?: boolean } = {}
) =>
  useQuery({
    queryKey: keys.projectEverhour(projectId),
    queryFn: () => api.getProjectEverhour(projectId),
    enabled: options.enabled ?? true,
    staleTime: options.poll ? 0 : 5 * 60_000,
    refetchInterval: options.poll ? 15_000 : false
  });

export function useStartProjectTimer(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.startProjectTimer(projectId),
    onSuccess: data => {
      qc.setQueryData(keys.projectEverhour(projectId), data);
      invalidateMissionEverhourQueries(qc);
    }
  });
}

export function useStopProjectTimer(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.stopProjectTimer(projectId),
    onSuccess: data => {
      qc.setQueryData(keys.projectEverhour(projectId), data);
      invalidateMissionEverhourQueries(qc);
    }
  });
}

export function useAddProjectTime(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEverhourTimeBody) => api.addProjectTime(projectId, body),
    onSuccess: data => qc.setQueryData(keys.projectEverhour(projectId), data)
  });
}

export function useUpdateProjectTime(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, body }: { recordId: string; body: UpdateEverhourTimeBody }) =>
      api.updateProjectTime(projectId, recordId, body),
    onSuccess: data => qc.setQueryData(keys.projectEverhour(projectId), data)
  });
}

export function useDeleteProjectTime(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recordId: string) => api.deleteProjectTime(projectId, recordId),
    onSuccess: data => qc.setQueryData(keys.projectEverhour(projectId), data)
  });
}

/**
 * Everhour state for one mission. Only enabled once we know the workspace is
 * connected, so a disconnected workspace never hits the proxy. Polls while the
 * caller opts in (e.g. a running timer) to keep elapsed time roughly fresh.
 */
export const useMissionEverhour = (
  id: string,
  options: { enabled?: boolean; poll?: boolean } = {}
) =>
  useQuery({
    queryKey: keys.missionEverhour(id),
    queryFn: () => api.getMissionEverhour(id),
    enabled: options.enabled ?? true,
    staleTime: options.poll ? 0 : 5 * 60_000,
    refetchInterval: options.poll ? 15_000 : false
  });

export function useStartMissionTimer(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.startMissionTimer(missionId),
    onSuccess: data => {
      qc.setQueryData(keys.missionEverhour(missionId), data);
      invalidateProjectEverhourQueries(qc);
    }
  });
}

export function useStopMissionTimer(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.stopMissionTimer(missionId),
    onSuccess: data => {
      qc.setQueryData(keys.missionEverhour(missionId), data);
      invalidateProjectEverhourQueries(qc);
    }
  });
}

export function useAddMissionTime(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEverhourTimeBody) => api.addMissionTime(missionId, body),
    onSuccess: data => qc.setQueryData(keys.missionEverhour(missionId), data)
  });
}

export function useUpdateMissionTime(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, body }: { recordId: string; body: UpdateEverhourTimeBody }) =>
      api.updateMissionTime(missionId, recordId, body),
    onSuccess: data => qc.setQueryData(keys.missionEverhour(missionId), data)
  });
}

export function useDeleteMissionTime(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recordId: string) => api.deleteMissionTime(missionId, recordId),
    onSuccess: data => qc.setQueryData(keys.missionEverhour(missionId), data)
  });
}
