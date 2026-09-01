import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';

import type {
  ActivityFeedDto,
  BranchActionBody,
  CreateInboxItemBody,
  CreateMissionBody,
  DeliveryDto,
  InboxItemDto,
  InboxMissionsResponse,
  MissionDetailDto,
  MissionScheduleDto,
  PreviewScheduleBody,
  RemoveWorktreeBody,
  ScheduleInput,
  UpdateArtifactBody,
  UpdateInboxItemBody,
  UpdateMissionBody
} from '../../../shared/contract.ts';
import { api, ApiRequestError } from '../api.ts';
import {
  fetchMissionBranchesFromLocalTarget,
  fetchWorktreesFromLocalTarget,
  gatherCommitDiffOnLocalTarget,
  purgeMergedWorktreesOnLocalTarget,
  removeWorktreeOnLocalTarget,
  resolveClientBranchActionContext,
  resolvePrimaryResourceForTarget,
  runBranchActionOnLocalTarget
} from '../local-target-branch.ts';
import {
  isLocalTargetCapabilityAvailable,
  useLocalTargetCapabilityAvailable
} from '../local-target-client.ts';
import {
  isRemoteExecutionTargetSelected,
  useIsRemoteExecutionTargetForProject
} from '../local-target-remote.ts';
import { invalidateNonEverhourQueries } from '../query-invalidation.ts';
import { keys } from '../query-keys.ts';

import { useProjectExecutionTarget } from './agent-launch-config.ts';
import {
  createReorderBoardColumnMutation,
  createReorderMyMissionsMutation
} from './optimistic-updates.ts';
import { useAllProjects, useProjectResources } from './projects.ts';

function invalidateAll(qc: QueryClient) {
  invalidateNonEverhourQueries(qc);
}

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
export const useMissionAgentRequests = (id: string, objectiveId?: string | null, enabled = true) =>
  useQuery({
    queryKey: keys.missionAgentRequests(id, objectiveId),
    queryFn: () => api.listAgentRequests(id, objectiveId).then(result => result.requests),
    enabled:
      enabled &&
      Boolean(id) &&
      (objectiveId === undefined || objectiveId === null || Boolean(objectiveId)),
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
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.missionAgentRequests(missionId) });
      void qc.invalidateQueries({ queryKey: keys.missionEvents(missionId) });
      void qc.invalidateQueries({ queryKey: keys.mission(missionId) });
      void qc.invalidateQueries({ queryKey: keys.activityFeed });
    }
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
      qc.setQueryData<import('../../../shared/contract.ts').ArtifactDto[]>(
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
    mutationFn: (body: import('../../../shared/contract.ts').UpsertSharedContextBody) =>
      api.upsertMissionSharedContext(missionId, body),
    onSuccess: entry => {
      qc.setQueryData<import('../../../shared/contract.ts').SharedContextEntryDto[]>(
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
 * Cross-workspace recent (non-agent Next excluded) + agent-created Next missions
 * for the Inbox page.
 * Invalidated with mission workflow changes via `keys.inboxMissions`.
 */
export function useInboxMissions() {
  return useQuery<InboxMissionsResponse>({
    queryKey: keys.inboxMissions,
    queryFn: api.listInboxMissions
  });
}

/**
 * Cross-workspace objective activity for the Feed page. Freshness comes from the
 * realtime change link invalidating `keys.activityFeed`, not from polling — the
 * `refetchOnWindowFocus` default is the only fallback for a dropped stream.
 * Older delivered missions load two weeks at a time as the operator scrolls.
 */
export function useActivityFeed() {
  return useInfiniteQuery({
    queryKey: keys.activityFeed,
    queryFn: ({ pageParam }: { pageParam: string | null }) => api.getActivityFeed(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ActivityFeedDto) => lastPage.nextBefore
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
          throw new ApiRequestError(
            `${mission.branch?.name ?? 'The mission branch'} is not checked out on this device.`,
            409,
            'BRANCH_NO_WORKTREE',
            'Run the mission to check the branch out here, or switch the mission to another branch.'
          );
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
          throw new ApiRequestError(
            `${mission.branch?.name ?? 'The mission branch'} is not checked out on this device.`,
            409,
            'BRANCH_NO_WORKTREE',
            'Run the mission to check the branch out here, or switch the mission to another branch.'
          );
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
