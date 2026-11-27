import type {
  ActivityFeedDto,
  BranchActionBody,
  CreateArtifactBody,
  CreateInboxItemBody,
  CreateMissionBody,
  HumanAgentRequestDto,
  InboxItemDto,
  InboxMissionsResponse,
  MissionDeliveriesDto,
  MissionDetailDto,
  MissionScheduleDto,
  MissionSummaryResponse,
  ObjectiveAttachmentDto,
  PreviewScheduleBody,
  RemoveWorktreeBody,
  ScheduleInput,
  UpdateArtifactBody,
  UpdateInboxItemBody,
  UpdateMissionBody
} from '@overlord/contract';
import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';
import { useMemo } from 'react';

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
import {
  blockingOpenRequests,
  fetchCompleteOpenAgentRequests,
  groupOpenRequestsByObjective,
  OPEN_REQUEST_PAGE_LIMIT,
  type OpenAgentRequestCollection,
  openAgentRequestState
} from '../open-agent-requests.ts';
import { invalidateNonEverhourQueries as invalidateAll } from '../query-invalidation.ts';
import { keys, type MissionBoardScope } from '../query-keys.ts';

import { useProjectExecutionTarget } from './agent-launch-config.ts';
import { createReorderBoardColumnMutation } from './optimistic-updates.ts';
import { useAllProjects, useProjectResources } from './projects.ts';

// Boards default to the server's rolling completed-mission window; the column
// "Show older missions" control switches the scope to the full
// archive. The scope is part of the query key so the two responses are cached
// separately, and both stay under the `missions(projectId)`
// prefixes every existing invalidation already targets.
export const useMissions = (projectId: string, scope: MissionBoardScope = 'recent') =>
  useQuery({
    queryKey: keys.missionsScoped(projectId, scope),
    queryFn: () => api.listMissions(projectId, { includeAllCompleted: scope === 'all-completed' }),
    // Widening the scope changes the key, and the pages gate their whole render
    // on the first load. Holding the narrower result keeps the board on screen
    // while the archive loads, so "show older" reads as a load-more rather than
    // a page reload; `isPlaceholderData` is what marks that in-between state.
    placeholderData: keepPreviousData
  });

export const missionQueryOptions = (id: string) =>
  queryOptions({
    queryKey: keys.mission(id),
    queryFn: () => api.getMission(id)
  });

export const useMission = (id: string, options: { refetchBranchState?: boolean } = {}) =>
  useQuery({
    ...missionQueryOptions(id),
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
  useQuery<MissionDeliveriesDto>({
    queryKey: keys.missionDeliveries(id),
    queryFn: () => api.listMissionDeliveries(id),
    enabled
  });

/**
 * The mission summary envelope (contract v166). Its `eligible` flag decides
 * whether the objective accordion trims delivery cards; realtime invalidates it
 * on `mission_summary`, `delivery`, `agent_request` and `mission_item`.
 */
export const useMissionSummary = (id: string, enabled = true) =>
  useQuery<MissionSummaryResponse>({
    queryKey: keys.missionSummary(id),
    queryFn: () => api.getMissionSummary(id),
    enabled: enabled && Boolean(id)
  });

/**
 * Acknowledge a displayed summary snapshot (`PUT /api/missions/:id/summary/seen`).
 * The server stores `max(existing, watermark)` and records no entity change, so
 * the cached envelope's `seenAt` is advanced here, monotonically. Callers keep
 * their own visit baseline; this never changes which rows carry a dot.
 */
export function useMarkMissionSummarySeen(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (watermark: string) => api.markMissionSummarySeen(id, { watermark }),
    onSuccess: ({ seenAt }) => {
      qc.setQueryData<MissionSummaryResponse>(keys.missionSummary(id), current => {
        if (!current?.eligible) return current;
        const stored = current.seenAt ? Date.parse(current.seenAt) : Number.NEGATIVE_INFINITY;
        return Date.parse(seenAt) > stored ? { ...current, seenAt } : current;
      });
    }
  });
}

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

/**
 * The shared, complete open-request collection for a mission (or one objective).
 *
 * Every consumer — the mission's blocking-question slot, row tints and the objective detail —
 * reads this one cache entry, so they never disagree. It reads every server page (status filtered
 * before the limit), deduplicates, polls every 5s, and is refreshed by realtime `agent_request`
 * / channel changes and by answering (both invalidate the `missionAgentRequests(id)` prefix it is
 * nested under). A failed read keeps the last successful collection (`stale`) and reports
 * `error` with `retry`; only `authoritative` (latest read succeeded and reached the last page)
 * may justify treating absence as resolution.
 */
export function useMissionOpenAgentRequests(
  missionId: string,
  { objectiveId = null, enabled = true }: { objectiveId?: string | null; enabled?: boolean } = {}
) {
  const client = useQueryClient();
  const queryKey = keys.missionOpenAgentRequests(missionId, objectiveId);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const next = await fetchCompleteOpenAgentRequests(cursor => {
        if (signal.aborted) throw signal.reason ?? new Error('aborted');
        return api.listOpenAgentRequestsPage(missionId, {
          objectiveId,
          cursor,
          limit: OPEN_REQUEST_PAGE_LIMIT
        });
      });
      if (next.complete) return next;
      // Missing rows in a bounded/legacy read are not evidence of resolution.
      // Merge in the shared cache so mission and detail keep the same blocked state.
      const previous = client.getQueryData<OpenAgentRequestCollection>(queryKey);
      const byId = new Map(previous?.requests.map(request => [request.id, request]));
      for (const request of next.requests) byId.set(request.id, request);
      return {
        ...next,
        requests: [...byId.values()].sort(
          (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
        )
      };
    },
    enabled: enabled && Boolean(missionId),
    refetchInterval: 5_000
  });
  const collection = query.data;
  const requests = collection?.requests ?? EMPTY_OPEN_REQUESTS;
  const state = openAgentRequestState({
    hasData: collection !== undefined,
    isError: query.isError,
    complete: collection?.complete ?? false
  });
  return {
    /** Open requests of every kind from the last successful read, oldest first. */
    requests,
    /** Open question/choice requests: the blocking subset. */
    blocking: useMemo(() => blockingOpenRequests(requests), [requests]),
    /** Blocking requests grouped by objective id. */
    blockingByObjective: useMemo(
      () => groupOpenRequestsByObjective(blockingOpenRequests(requests)),
      [requests]
    ),
    state,
    isLoading: state === 'loading',
    /** The latest read succeeded and reached the last page. */
    authoritative: state === 'complete',
    /** Showing a previous collection because the latest read failed. */
    stale: state === 'error' && collection !== undefined,
    error: query.error,
    retry: () => query.refetch()
  };
}

const EMPTY_OPEN_REQUESTS: HumanAgentRequestDto[] = [];

/** Dismiss or restore only the member's notification (ADR 0063). */
export function useAgentRequestDismissal(missionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      request,
      dismissed
    }: {
      request: Pick<HumanAgentRequestDto, 'id' | 'revision'>;
      dismissed: boolean;
    }) =>
      dismissed
        ? api.dismissAgentRequest(request.id, { expectedRevision: request.revision })
        : api.restoreAgentRequest(request.id),
    onSuccess: ({ request }) => {
      client.setQueryData<OpenAgentRequestCollection>(
        keys.missionOpenAgentRequests(missionId),
        current =>
          current && {
            ...current,
            requests: current.requests.map(item =>
              item.id === request.id && item.revision === request.revision
                ? {
                    ...item,
                    dismissed: request.dismissed === true,
                    dismissedAt: request.dismissedAt ?? null
                  }
                : item
            )
          }
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.missionAgentRequests(missionId) })
  });
}

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

/**
 * Send a recorded answer again after a failed or unconfirmed delivery (ADR 0065). The server's
 * attempt compare-and-set admits one redelivery however many clients press "Send again"; a
 * losing call answers 409 `agent_request_delivery_conflict` and the card refreshes.
 */
export function useRedeliverAgentRequest(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      expectedAttempt,
      confirmUnconfirmed
    }: {
      requestId: string;
      expectedAttempt: number;
      confirmUnconfirmed?: boolean;
    }) =>
      api.redeliverAgentRequest(requestId, {
        expectedAttempt,
        ...(confirmUnconfirmed ? { confirmUnconfirmed: true } : {})
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.missionAgentRequests(missionId) });
      void qc.invalidateQueries({ queryKey: keys.activityFeed });
    }
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
      qc.setQueryData<import('@overlord/contract').ArtifactDto[]>(
        keys.missionArtifacts(missionId),
        current => current?.map(item => (item.id === artifact.id ? artifact : item))
      );
    }
  });
}

export function useCreateMissionArtifact(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateArtifactBody) => api.createMissionArtifact(missionId, body),
    onSuccess: artifact => {
      qc.setQueryData<import('@overlord/contract').ArtifactDto[]>(
        keys.missionArtifacts(missionId),
        current => [artifact, ...(current ?? []).filter(item => item.id !== artifact.id)]
      );
    }
  });
}

export function useDeleteMissionArtifact(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (artifactId: string) => api.deleteMissionArtifact(missionId, artifactId),
    onSuccess: (_result, artifactId) => {
      qc.setQueryData<import('@overlord/contract').ArtifactDto[]>(
        keys.missionArtifacts(missionId),
        current => current?.filter(item => item.id !== artifactId)
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
    mutationFn: (body: import('@overlord/contract').UpsertSharedContextBody) =>
      api.upsertMissionSharedContext(missionId, body),
    onSuccess: entry => {
      qc.setQueryData<import('@overlord/contract').SharedContextEntryDto[]>(
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

// Mission-wide capped page. Only the unassigned-evidence fallback (rows whose
// objective was deleted) reads it; objective views use the objective read below
// rather than partition this capped list. `changed_file` and `agent_session`
// entity changes invalidate the shared prefix.
export const useMissionFileChanges = (id: string) =>
  useQuery({
    queryKey: keys.missionFileChanges(id),
    queryFn: () => api.listMissionFileChanges(id)
  });

/**
 * Cumulative synchronized path evidence and capture diagnostics for one
 * objective, filtered on the server before the 200-row cap.
 */
export const useObjectiveFileChanges = (
  missionId: string,
  objectiveId: string,
  { enabled = true }: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: keys.objectiveFileChanges(missionId, objectiveId),
    queryFn: () => api.listObjectiveFileChanges(missionId, objectiveId),
    enabled
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
 * Older delivered missions load three days at a time while Delivered is enabled.
 */
export function useActivityFeed(showDelivered: boolean) {
  return useInfiniteQuery({
    queryKey: keys.activityFeed,
    queryFn: ({ pageParam }: { pageParam: string | null }) => api.getActivityFeed(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ActivityFeedDto) => (showDelivered ? lastPage.nextBefore : null)
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

// ---- Inbox item attachments ----------------------------------------------

export const useInboxItemAttachments = (
  inboxItemId: string,
  { enabled = true }: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: keys.inboxItemAttachments(inboxItemId),
    queryFn: () => api.listInboxItemAttachments(inboxItemId),
    enabled
  });

/** Refresh one capture's files plus the list, whose rows carry `attachmentCount`. */
export function invalidateInboxItemAttachments(qc: QueryClient, inboxItemId: string) {
  void qc.invalidateQueries({ queryKey: keys.inboxItemAttachments(inboxItemId) });
  void qc.invalidateQueries({ queryKey: keys.inbox });
}

export function useUploadInboxItemAttachment(inboxItemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadInboxItemAttachment(inboxItemId, file),
    onSuccess: attachment => {
      qc.setQueryData<ObjectiveAttachmentDto[]>(keys.inboxItemAttachments(inboxItemId), prev =>
        prev ? [...prev, attachment] : [attachment]
      );
      invalidateInboxItemAttachments(qc, inboxItemId);
    }
  });
}

export function useDeleteInboxItemAttachment(inboxItemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => api.deleteInboxItemAttachment(inboxItemId, attachmentId),
    onSuccess: remaining => {
      qc.setQueryData(keys.inboxItemAttachments(inboxItemId), remaining);
      invalidateInboxItemAttachments(qc, inboxItemId);
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
  const isRemoteTarget = useIsRemoteExecutionTargetForProject(
    mission.projectId,
    mission.workspaceId
  );
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
      const project = projectId ? projectList.find(candidate => candidate.id === projectId) : null;
      const isRemoteTarget = project
        ? isRemoteExecutionTargetSelected({
            localExecutionTargetId: (await api.getLaunchSettings(project.workspaceId))
              .executionTargetId,
            selectedExecutionTargetId: (await api.getProjectExecutionTarget(project.id))
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
      const remoteProjects = (
        await Promise.all(
          projectList.map(async project => {
            const [launchSettings, executionTarget] = await Promise.all([
              api.getLaunchSettings(project.workspaceId),
              api.getProjectExecutionTarget(project.id)
            ]);
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
