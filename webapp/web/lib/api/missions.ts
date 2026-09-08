import type {
  MissionSearchDateField,
  SearchMissionsResponseV2,
  SearchObjectiveState,
  SearchResponseV3,
  SearchResultEntityType
} from '@overlord/contract';

import type {
  ActivityFeedDto,
  AgentRequestDto,
  AgentSessionInputDto,
  AgentSessionInputsResponse,
  ArtifactDto,
  BranchActionBody,
  CreateArtifactBody,
  CreateInboxItemBody,
  CreateMissionBody,
  GenerateCommitMessageBody,
  GenerateCommitMessageResultDto,
  InboxItemDto,
  InboxMissionsResponse,
  MissionBranchListDto,
  MissionDeliveriesDto,
  MissionDetailDto,
  MissionDto,
  MissionEventDto,
  MissionFileChangesDto,
  MissionScheduleDto,
  MyMissionReorderRequest,
  MyMissionsResponse,
  PreviewScheduleBody,
  PurgeMergedWorktreesBody,
  PurgeWorktreesResultDto,
  RemoveWorktreeBody,
  ReorderBoardColumnBody,
  ScheduleInput,
  SharedContextEntryDto,
  UpdateArtifactBody,
  UpdateInboxItemBody,
  UpdateMissionBody,
  UpsertSharedContextBody,
  WorktreeDto
} from '../../../shared/contract.ts';

import { request } from './request.ts';

export const missionsApi = {
  listMissions: (
    projectId: string,
    options: { includeObjectives?: boolean; includeAllCompleted?: boolean } = {}
  ) => {
    const params = new URLSearchParams();
    if (options.includeObjectives) params.set('includeObjectives', '1');
    if (options.includeAllCompleted) params.set('includeAllCompleted', '1');
    const query = params.toString();
    return request<MissionDto[]>(
      'GET',
      `/api/projects/${projectId}/missions${query ? `?${query}` : ''}`
    );
  },
  reorderBoardColumn: (projectId: string, body: ReorderBoardColumnBody) =>
    request<MissionDto[]>('PATCH', `/api/projects/${projectId}/board/reorder`, body),
  listWorkspaceMyMissions: (options: { includeAllCompleted?: boolean } = {}) =>
    request<MyMissionsResponse>(
      'GET',
      `/api/workspace/my-missions${options.includeAllCompleted ? '?includeAllCompleted=1' : ''}`
    ),
  reorderWorkspaceMyMissions: (body: MyMissionReorderRequest) =>
    request<MyMissionsResponse>('PATCH', `/api/workspace/my-missions/order`, body),

  searchMissions: (query: string, options: { projectId?: string; limit?: number } = {}) => {
    const params = new URLSearchParams({ q: query });
    if (options.projectId) params.set('projectId', options.projectId);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return request<{ missions: MissionDto[] }>('GET', `/api/missions/search?${params.toString()}`);
  },
  searchMissionsV2: (
    query: string,
    options: {
      projectIds?: string[];
      resourceKeys?: string[];
      dateField?: MissionSearchDateField;
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ) => {
    const params = new URLSearchParams({ q: query });
    if (options.projectIds?.length) params.set('projectIds', options.projectIds.join(','));
    if (options.resourceKeys?.length) params.set('resourceKeys', options.resourceKeys.join(','));
    if (options.dateField) params.set('dateField', options.dateField);
    if (options.from) params.set('from', options.from);
    if (options.to) params.set('to', options.to);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return request<SearchMissionsResponseV2>('GET', `/api/missions/search/v2?${params.toString()}`);
  },
  searchMissionsV3: (
    query: string,
    options: {
      projectIds?: string[];
      resourceKeys?: string[];
      dateField?: MissionSearchDateField;
      from?: string;
      to?: string;
      limit?: number;
      entityTypes?: SearchResultEntityType[];
      objectiveStates?: SearchObjectiveState[];
      matchesPerResult?: number;
    } = {}
  ) => {
    const params = new URLSearchParams({ q: query });
    if (options.projectIds?.length) params.set('projectIds', options.projectIds.join(','));
    if (options.resourceKeys?.length) params.set('resourceKeys', options.resourceKeys.join(','));
    if (options.dateField) params.set('dateField', options.dateField);
    if (options.from) params.set('from', options.from);
    if (options.to) params.set('to', options.to);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.entityTypes?.length) params.set('entityTypes', options.entityTypes.join(','));
    if (options.objectiveStates?.length) {
      params.set('objectiveStates', options.objectiveStates.join(','));
    }
    if (options.matchesPerResult !== undefined) {
      params.set('matchesPerResult', String(options.matchesPerResult));
    }
    return request<SearchResponseV3>('GET', `/api/search/v3?${params.toString()}`);
  },
  getMission: (id: string) => request<MissionDetailDto>('GET', `/api/missions/${id}`),
  createMission: (body: CreateMissionBody) =>
    request<MissionDetailDto>('POST', '/api/missions', body),
  listInboxItems: () => request<InboxItemDto[]>('GET', '/api/inbox'),
  /** Cross-workspace recent + agent-Next missions for the Inbox column (coo:826). */
  listInboxMissions: () => request<InboxMissionsResponse>('GET', '/api/inbox/missions'),
  getActivityFeed: (before?: string | null) => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    const query = params.toString();
    return request<ActivityFeedDto>('GET', `/api/activity-feed${query ? `?${query}` : ''}`);
  },
  createInboxItem: (body: CreateInboxItemBody) => request<InboxItemDto>('POST', '/api/inbox', body),
  updateInboxItem: (id: string, body: UpdateInboxItemBody) =>
    request<InboxItemDto>('PATCH', `/api/inbox/${id}`, body),
  deleteInboxItem: (id: string) => request<{ ok: true }>('DELETE', `/api/inbox/${id}`),
  promoteInboxItem: (id: string, projectId: string) =>
    request<MissionDetailDto>('POST', `/api/inbox/${id}/promote`, { projectId }),
  updateMission: (id: string, body: UpdateMissionBody) =>
    request<MissionDetailDto>('PATCH', `/api/missions/${id}`, body),
  getMissionSchedule: (id: string) =>
    request<MissionScheduleDto>('GET', `/api/missions/${id}/schedule`),
  upsertMissionSchedule: (id: string, body: ScheduleInput) =>
    request<MissionScheduleDto>('PUT', `/api/missions/${id}/schedule`, body),
  clearMissionSchedule: (id: string) =>
    request<{ ok: true }>('DELETE', `/api/missions/${id}/schedule`),
  previewMissionSchedule: (body: PreviewScheduleBody) =>
    request<{ dueDatetime: string }>('POST', '/api/missions/schedule/preview', body),
  deleteMission: (id: string) => request<{ ok: true }>('DELETE', `/api/missions/${id}`),
  generateMissionTitle: (id: string) =>
    request<MissionDetailDto>('POST', `/api/missions/${id}/generate-title`),
  generateCommitMessage: (id: string, body?: GenerateCommitMessageBody) =>
    request<GenerateCommitMessageResultDto>(
      'POST',
      `/api/missions/${id}/generate-commit-message`,
      body
    ),
  branchAction: (id: string, body: BranchActionBody) =>
    request<MissionDetailDto>('POST', `/api/missions/${id}/branch/action`, body),
  listMissionBranches: (id: string) =>
    request<MissionBranchListDto>('GET', `/api/missions/${id}/branches`),
  listWorktrees: () => request<WorktreeDto[]>('GET', '/api/worktrees'),
  removeWorktree: (body: RemoveWorktreeBody) =>
    request<PurgeWorktreesResultDto>('POST', '/api/worktrees/remove', body),
  purgeMergedWorktrees: (body?: PurgeMergedWorktreesBody) =>
    request<PurgeWorktreesResultDto>('POST', '/api/worktrees/purge-merged', body),
  listMissionEvents: (id: string) =>
    request<MissionEventDto[]>('GET', `/api/missions/${id}/events`),
  forgetMissionLatchSession: (
    missionId: string,
    body: { providerSessionId: string; executionRequestId?: string | null }
  ) =>
    request<{ forgotten: boolean; executionRequestId: string | null }>(
      'POST',
      `/api/missions/${missionId}/terminal-sessions/forget`,
      body
    ),
  listMissionDeliveries: (id: string) =>
    request<MissionDeliveriesDto>('GET', `/api/missions/${id}/deliveries`),
  listMissionArtifacts: (id: string) =>
    request<ArtifactDto[]>('GET', `/api/missions/${id}/artifacts`),
  createMissionArtifact: (missionId: string, body: CreateArtifactBody) =>
    request<ArtifactDto>('POST', `/api/missions/${missionId}/artifacts`, body),
  updateMissionArtifact: (missionId: string, artifactId: string, body: UpdateArtifactBody) =>
    request<ArtifactDto>('PATCH', `/api/missions/${missionId}/artifacts/${artifactId}`, body),
  listMissionSharedContext: (id: string) =>
    request<SharedContextEntryDto[]>('GET', `/api/missions/${id}/context`),
  upsertMissionSharedContext: (missionId: string, body: UpsertSharedContextBody) =>
    request<SharedContextEntryDto>('PUT', `/api/missions/${missionId}/context`, body),
  listMissionFileChanges: (id: string) =>
    request<MissionFileChangesDto>('GET', `/api/missions/${id}/file-changes`),

  listAgentSessionInputs: (missionId: string) =>
    request<AgentSessionInputsResponse>(
      'GET',
      `/api/agent-session-inputs?missionId=${encodeURIComponent(missionId)}`
    ),
  cancelAgentSessionInput: (inputId: string) =>
    request<{ cancelled: boolean; input: AgentSessionInputDto }>(
      'POST',
      `/api/agent-session-inputs/${encodeURIComponent(inputId)}/cancel`
    ),
  enqueueAgentSessionInput: (body: {
    channelId: string;
    body: string;
    kind?: 'instruction' | 'retry' | 'continue';
  }) =>
    request<{
      input: {
        id: string;
        deliveryLabel: string;
        status: string;
      };
    }>('POST', '/api/agent-session-inputs', body),

  listAgentRequests: (missionId: string, objectiveId?: string | null) =>
    request<{ requests: AgentRequestDto[] }>(
      'GET',
      `/api/agent-requests?missionId=${encodeURIComponent(missionId)}${
        objectiveId ? `&objectiveId=${encodeURIComponent(objectiveId)}` : ''
      }`
    ),
  /**
   * Answer a request. `expectedRevision` is required by the server: a stale card must lose
   * rather than overwrite a decision someone else already made.
   */
  resolveAgentRequest: (
    requestId: string,
    body: { resolution: Record<string, unknown>; expectedRevision: number }
  ) =>
    request<{ resolved: boolean; request: AgentRequestDto }>(
      'POST',
      `/api/agent-requests/${encodeURIComponent(requestId)}/resolve`,
      body
    ),
  /** Hand the decision back to the native terminal prompt without answering it. */
  releaseAgentRequest: (requestId: string) =>
    request<{ released: boolean; request: AgentRequestDto }>(
      'POST',
      `/api/agent-requests/${encodeURIComponent(requestId)}/release`
    )
};
