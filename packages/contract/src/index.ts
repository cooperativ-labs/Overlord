/**
 * Typed API contract shared between the REST server (`backend/`) and its
 * clients (`webapp/`, `cli/`, `desktop/`, `mcp/`). Every REST DTO is generated
 * from contract/api/openapi.yaml into `./generated/api.ts` (ADR 0050) and
 * re-exported here; this module adds only the shapes the description does not
 * carry (protocol and MCP payloads, CLI-local reads, vocabularies narrower than
 * a wire `string`, the virtual-target gateway surface) and shared runtime
 * helpers such as the launch-variable catalog (`LAUNCH_VARIABLES`) and the
 * objective-reference grammar.
 */

import type {
  ActivityFeedDto,
  AgentLaunchConfigDto,
  AgentRequestOption,
  AgentSessionInputListResponse,
  ApnsEnvironment,
  CaptureSessionDto,
  CreateWebhookSubscriptionResultDto,
  EntityChangeOperation,
  ErrorEnvelope,
  ExecutionRequestDto,
  FileChangeDto,
  HumanActionCategory,
  HumanActionResolutionDto,
  InboxMissionDto,
  ProjectResourceDto,
  RealtimeStreamEvent,
  RecordedObservationsDto,
  RegisterLiveActivityPushTokenBody,
  ReportMissionBranchObservationsBody,
  ReportResourceObservationsBody,
  TerminalSessionDto
} from './generated/api.js';

export {
  type AgentLaunchFlagDto,
  agentLaunchFlagKey,
  agentLaunchFlagsToArgv,
  formatAgentLaunchFlagText,
  formatOvldLaunchCommand,
  formatShellWord,
  normalizeAgentLaunchFlags,
  parseAgentLaunchFlagText
} from './agent-launch-flags.js';
export { normalizeBaseUrl } from './base-url.js';
export * from './chat.js';
// Every REST DTO is generated from contract/api/openapi.yaml (ADR 0006). The
// chat, search and extension DTOs are re-exported from their own modules.
export type {
  AcceptWorkspaceInvitationBody,
  ActivityFeedDto,
  ActivityFeedMissionItemDto,
  ActivityFeedMissionObjectiveDto,
  ActivityFeedQuestionItemDto,
  AddOrganizationAdminBody,
  AgentCatalogAgentDto,
  AgentCatalogDto,
  AgentCatalogModelDto,
  AgentLaunchConfigDto,
  AgentLaunchConfigInput,
  AgentLaunchFlagInput,
  AgentRequestDeliveryDto,
  AgentRequestDto,
  AgentRequestKind,
  AgentRequestLeaseBody,
  AgentRequestLeaseDto,
  AgentRequestListResponse,
  AgentRequestOption,
  AgentRequestResolvedElsewhereDto,
  AgentRequestStatus,
  AgentSessionChannelSelfDto,
  AgentSessionChannelSnapshotDto,
  AgentSessionChannelState,
  AgentSessionEventInput,
  AgentSessionHeartbeatBody,
  AgentSessionHeartbeatDto,
  AgentSessionInputDto,
  AgentSessionInputKind,
  AgentSessionInputListResponse,
  AgentSessionInputStatus,
  ApnsEnvironment,
  AppendAgentSessionEventsBody,
  AppendAgentSessionEventsDto,
  ArtifactDto,
  ArtifactList,
  AuthorizedWorkspaceDiscoveryDto,
  AuthorizedWorkspaceDto,
  AuthProvidersDto,
  BinaryDownload,
  BranchActionBody,
  BranchPreparedBody,
  CapabilityResultDto,
  CapabilityTargetMetadataDto,
  CaptureHealthEntryDto,
  CaptureSessionDto,
  ClaimedAgentSessionInputDto,
  CreateAgentRequestBody,
  CreateArtifactBody,
  CreatedAgentRequestDto,
  CreatedByKind,
  CreateInboxItemBody,
  CreateMissionBody,
  CreateObjectiveBody,
  CreateOrganizationOnboardingBody,
  CreateProjectBody,
  CreateProjectResourceBody,
  CreateProjectStatusBody,
  CreateProjectTagBody,
  CreateRunQueueBody,
  CreateUserTokenBody,
  CreateUserTokenResultDto,
  CreateWebhookSubscriptionBody,
  CreateWebhookSubscriptionResultDto,
  CreateWorkspaceBody,
  DateTime,
  DefaultProjectPreferenceDto,
  DeferredWorkV1,
  DeleteRunQueueBody,
  DeleteRunQueueEntryBody,
  DeliveryAgentReportV1,
  DeliveryDeferredWorkItemDto,
  DeliveryDto,
  DeliveryPresentationV1,
  DeliveryReportPayloadV1,
  EligibleExecutionTargetDto,
  EndAgentSessionChannelBody,
  EnqueueRunQueueEntryBody,
  EntityChangeDto,
  EntityChangeOperation,
  ErrorEnvelope,
  ExecutionProviderDto,
  ExecutionRequestDto,
  ExecutionRequestStatus,
  ExecutionTargetMigrationDiagnosticsDto,
  ExecutionTargetRunnerRegistrationDto,
  FileChangeDto,
  ForgetTerminalSessionBody,
  ForgetTerminalSessionResultDto,
  GenerateCommitMessageBody,
  GenerateCommitMessageResultDto,
  HumanActionCategory,
  HumanActionResolutionDto,
  HumanActionV1,
  HumanAgentRequestDto,
  InboxItemDto,
  InboxItemList,
  InboxMissionDto,
  InboxMissionsResponse,
  InitializeProjectBody,
  InitializeProjectResultDto,
  InviteWorkspaceMemberBody,
  InviteWorkspaceMemberResultDto,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonValue,
  KnowledgebaseClientMetadataDto,
  LaunchObjectiveBody,
  LaunchPreferenceDto,
  LaunchSessionDefaultsDto,
  LaunchSessionSource,
  LaunchSettingsDto,
  LocalTargetBridgeCallBody,
  LocalTargetErrorCode,
  MarkAgentSessionInputEmittedBody,
  MarkAgentSessionInputFailedBody,
  MarkMissionSummarySeenBody,
  McpServerInfoDto,
  MessageErrorBody,
  MetaDto,
  MissionBranchDto,
  MissionBranchListDto,
  MissionBranchStatus,
  MissionCreatedFromDto,
  MissionCreatorTokenDto,
  MissionDeliveriesDto,
  MissionDetailDto,
  MissionDto,
  MissionEventActorDto,
  MissionEventDto,
  MissionEventList,
  MissionFileChangesDto,
  MissionList,
  MissionPriority,
  MissionScheduleDto,
  MissionSearchV1Response,
  MissionSummaryActionDto,
  MissionSummaryDto,
  MissionSummaryEvidenceDto,
  MissionSummaryResponse,
  MissionSummaryRiskDto,
  MissionSummarySeenResponse,
  MissionSummarySourceDto,
  MissionSummaryStatus,
  MissionSummarySuggestionDto,
  MissionWorktreePreference,
  NotificationDto,
  NotificationList,
  NotificationPreferenceDto,
  NotificationPreferencesDto,
  NotificationPreferenceType,
  NotificationRevisionBody,
  OAuthApproveBody,
  OAuthApproveResultDto,
  OAuthAuthorizationRequestBody,
  OAuthAuthorizationRequestInfoDto,
  OAuthAuthorizationServerMetadata,
  OAuthClientRegistrationBody,
  OAuthClientRegistrationDto,
  OAuthConsentOrganizationDto,
  OAuthConsentWorkspaceDto,
  OAuthErrorBody,
  OAuthHandoffExchangeBody,
  OAuthHandoffExchangeResultDto,
  OAuthProtectedResourceMetadata,
  OAuthRevokeBody,
  OAuthScope,
  OAuthTokenRequestBody,
  OAuthTokenResponseDto,
  ObjectiveAttachmentDto,
  ObjectiveAttachmentList,
  ObjectiveDto,
  ObjectiveEffectiveLaunchConfigDto,
  ObjectiveFileChangesDto,
  ObjectiveLaunchCommandDto,
  ObjectiveList,
  ObjectivePromptDto,
  ObjectiveRunQueueEntryDto,
  ObjectiveState,
  ObjectiveTranscriptItemDto,
  ObjectiveTranscriptPageDto,
  OkResponse,
  OrganizationAdminDto,
  OrganizationAdminList,
  OrganizationDto,
  OrganizationList,
  PreviewScheduleBody,
  ProfileDto,
  ProjectDto,
  ProjectExecutionTargetDto,
  ProjectLifecycle,
  ProjectList,
  ProjectListLifecycle,
  ProjectRepositoryDto,
  ProjectResourceAccessMode,
  ProjectResourceDto,
  ProjectResourceList,
  ProjectResourceSourceDto,
  ProjectRunQueuesDto,
  ProjectStatusDto,
  ProjectStatusList,
  ProjectTagDto,
  ProjectTagList,
  PromoteInboxItemBody,
  ProtocolRequestBody,
  PurgeMergedWorktreesBody,
  PurgeWorktreesResultDto,
  PushNotificationCategory,
  RawImageUploadBody,
  RawUploadBody,
  RealtimeChangeEventDto,
  RealtimeStreamEvent,
  RecordAgentRequestApplicationBody,
  RecordedObservationsDto,
  RegisterDevicePushTokenBody,
  RegisterExecutionTargetBody,
  RegisterLiveActivityPushTokenBody,
  RegisterLiveActivityStartTokenBody,
  ReleaseAgentRequestBody,
  ReleasedAgentRequestDto,
  RemoveWorktreeBody,
  ReorderBoardColumnBody,
  ReorderObjectivesBody,
  ReorderProjectRunQueuesBody,
  ReorderProjectsBody,
  ReorderProjectStatusesBody,
  ReorderRunQueueBody,
  ReportMissionBranchObservationsBody,
  ReportResourceObservationsBody,
  RepositoryEntryDto,
  ResolveAgentRequestBody,
  ResolveAgentRequestResultDto,
  ResolvedLaunchSessionDto,
  ResolveHumanActionBody,
  RevokeDevicePushTokenBody,
  RevokeLiveActivityStartTokenBody,
  RunnerClaimBody,
  RunnerClaimedRequestDto,
  RunnerClaimResponse,
  RunnerClearBody,
  RunnerClearResultDto,
  RunnerCompletedBody,
  RunnerExecutionRequestDto,
  RunnerFailedBody,
  RunnerLaunchedBody,
  RunnerStatusDto,
  RunQueueDto,
  RunQueueEntryDto,
  RunQueueEntryRemovalDto,
  RunQueueEntryState,
  RunQueueRemovalDto,
  RunQueueWaitingReason,
  ScheduleDto,
  ScheduleInput,
  SchedulePreviewDto,
  ScheduleWeekDayDto,
  ServerMetaDto,
  SetDefaultProjectBody,
  SharedContextEntryDto,
  SharedContextEntryList,
  StaleBackendHostExecutionTargetDto,
  StatusType,
  StorageBucketKey,
  StoredImageDto,
  SyncChangesDto,
  TargetObservationState,
  TerminalProfileDto,
  TerminalSessionDto,
  TokenScope,
  TradeoffMadeV1,
  UpdateAgentCatalogBody,
  UpdateAgentLaunchConfigBody,
  UpdateArtifactBody,
  UpdateInboxItemBody,
  UpdateLaunchPreferenceBody,
  UpdateLaunchSessionDefaultsBody,
  UpdateMissionBody,
  UpdateNotificationPreferencesBody,
  UpdateObjectiveBody,
  UpdateOrganizationBody,
  UpdateProfileBody,
  UpdateProjectBody,
  UpdateProjectExecutionTargetBody,
  UpdateProjectResourceBody,
  UpdateProjectResourceSourceBody,
  UpdateProjectStatusBody,
  UpdateProjectTagBody,
  UpdateRunQueueBody,
  UpdateRunQueueEntryBody,
  UpdateTerminalProfileBody,
  UpdateUserTokenBody,
  UpdateWebhookSubscriptionBody,
  UpdateWorkspaceBody,
  UpdateWorkspaceExecutionTargetBody,
  UpdateWorkspaceMemberRoleBody,
  UpdateWorktreeBranchAutomationBody,
  UpsertSharedContextBody,
  UserTokenDto,
  UserTokenList,
  UserTokenProjectDto,
  UserTokenStatus,
  WebhookDeliveryAttemptDto,
  WebhookDeliveryAttemptsPageDto,
  WebhookDisabledReason,
  WebhookEventType,
  WebhookPayloadMode,
  WebhookSubscriptionDto,
  WebhookSubscriptionList,
  WebhookTestResultDto,
  WorkspaceDto,
  WorkspaceExecutionTargetDto,
  WorkspaceExecutionTargetList,
  WorkspaceInvitationDto,
  WorkspaceInvitationList,
  WorkspaceInvitationStatus,
  WorkspaceList,
  WorkspaceMemberDto,
  WorkspaceMemberList,
  WorkspaceRoleKey,
  WorktreeDto,
  WorktreeList
} from './generated/api.js';
export {
  ATTACH_CONTEXT_FIELDS,
  LAUNCH_VARIABLE_NAMES,
  LAUNCH_VARIABLES,
  type LaunchVariableAvailability,
  type LaunchVariableDefinition
} from './launch-variables.js';
export {
  containsExactReference,
  invalidMissionReference,
  type KnowledgebaseFeatureIdentity,
  knowledgebaseFeatureReference,
  knowledgebaseFeatureUrl,
  MISSION_REFERENCE_DEFAULT_LIMIT,
  MISSION_REFERENCE_MAX_LENGTH,
  MISSION_REFERENCE_MAX_LIMIT,
  MISSION_REFERENCE_MIN_LENGTH,
  type MissionReferenceMatch,
  type MissionReferenceObjectiveMatch,
  type MissionReferenceSearchResponse,
  normalizeKnowledgebaseFeatureIdentity,
  parseKnowledgebaseFeatureReference
} from './mission-reference.js';
export {
  MISSION_SEARCH_DATE_FIELDS,
  type MissionSearchAppliedFilters,
  type MissionSearchDateField,
  type MissionSearchMatchKind,
  type MissionSearchMode,
  type MissionSearchResultV2,
  type MissionSearchWorkspaceCount,
  type SearchMissionsResponseV2
} from './mission-search.js';
export {
  NOTIFICATION_CATALOG,
  NOTIFICATION_MODES,
  NOTIFICATION_TRANSPORTS,
  NOTIFICATION_TYPES,
  type NotificationDescriptor,
  type NotificationMode,
  type NotificationTransport,
  type NotificationType,
  type NotificationTypeForTransport,
  notificationTypesForTransport
} from './notifications.js';
export {
  formatObjectiveDisplayId,
  missionDisplayIdFromObjectiveRef,
  OBJECTIVE_DISPLAY_ID_SEPARATOR,
  OBJECTIVE_DISPLAY_KEY_ALPHABET,
  OBJECTIVE_DISPLAY_KEY_LENGTH,
  type ParsedObjectiveRef,
  parseObjectiveRef
} from './objective-ref.js';
export {
  accessModeToResourcePathPermission,
  formatProjectResourcePathsFromManifest,
  formatResourcePathWithPermission,
  type ParsedResourcePathEntry,
  parseResourcePathEntry,
  parseResourcePathsCsv,
  type ResourcePathPermission
} from './resource-paths.js';
export {
  DEFAULT_MATCHES_PER_RESULT,
  DEFAULT_SEARCH_ENTITY_TYPES,
  MAX_MATCHES_PER_RESULT,
  parseMatchesPerResult,
  parseSearchEntityTypes,
  parseSearchObjectiveStates,
  SEARCH_CANDIDATE_FETCH_LIMIT,
  SEARCH_CHILD_CONTEXT_WEIGHT,
  SEARCH_OBJECTIVE_STATES,
  SEARCH_RESULT_ENTITY_TYPES,
  type SearchAppliedFiltersV3,
  type SearchEntityCounts,
  type SearchMatch,
  type SearchObjectiveState,
  type SearchParseResult,
  type SearchResponseV3,
  type SearchResultEntityType,
  type SearchResultV3
} from './search.js';
export { vocabulary } from './vocabulary.js';

// ---- Change feed ----

export type ChangeOperation = EntityChangeOperation;

// ---- Organization DTOs ----
//
// An organization is the grouping + identity layer above workspaces
// (organization → workspace → project). Workspaces remain the sole RBAC layer;
// an "organization admin" is a derived concept (ADMIN of every constituent
// workspace), not a new RBAC scope type.

/** Demotes `userId` to `MEMBER` in every constituent workspace of the organization. */
export interface RemoveOrganizationAdminBody {
  userId: string;
}

// ---- Resource DTOs ----

/** The wire type is wider: `ProjectResourceDto.type` is a string (generated; schema-disagreements P4). */
export type ProjectResourceType = 'local_directory' | 'remote_directory' | 'git' | 'source_bundle';
export type ProjectResourceStatus = ProjectResourceDto['status'];

export type TargetResourceObservationInput = ReportResourceObservationsBody['observations'][number];

export type RecordTargetResourceObservationsBody = ReportResourceObservationsBody;

export type RecordTargetResourceObservationsResult = RecordedObservationsDto;

export type MissionBranchObservationInput =
  ReportMissionBranchObservationsBody['observations'][number];

export type RecordMissionBranchObservationsBody = ReportMissionBranchObservationsBody;

export type RecordMissionBranchObservationsResult = RecordTargetResourceObservationsResult;

/** The wire type is wider: `ArtifactDto.type` is a string (generated). */
export type ArtifactType =
  | 'test_results'
  | 'next_steps'
  | 'note'
  | 'url'
  | 'decision'
  | 'migration';

// ---- Mission activity feed ----

/**
 * Closed vocabulary for `mission_events.type` (see the schema contract). These
 * are the workflow events surfaced in the mission panel's live activity feed.
 * The wire type is wider: `MissionEventDto.type` is a string (generated).
 */
export type MissionEventType =
  | 'update'
  | 'user_follow_up'
  | 'alert'
  | 'discussion_summary'
  | 'decision'
  | 'ask'
  | 'answer'
  | 'permission_request'
  | 'delivery'
  | 'execution_requested'
  | 'awaiting_approval'
  | 'status_change';

// ---- Agent Session Exchange human surfaces (coo:563, contract v53) --------

/** A discrete answer a client may return by id. Never rendered when the adapter cannot apply it. */
export type AgentRequestOptionDto = AgentRequestOption;

export type AgentSessionInputsResponse = AgentSessionInputListResponse;

// ---- Delivery reports (coo:364, contract v15) -----------------------------

/**
 * Raw agent-provided action evidence accepted in a delivery envelope.
 *
 * `action` is the imperative step. `reason` and `category` are expected on
 * every item (normalization tolerates their absence, defaulting `category` to
 * `other`). The optional `command`, `verify`, and `link` fields (contract v137)
 * make the step executable without re-reading the delivery: the exact command
 * or setting to apply, how the operator confirms it worked, and a URL or
 * repository-relative file path to open.
 */
export interface HumanActionInputV1 {
  action: string;
  reason?: string;
  category?: HumanActionCategory;
  blocking?: boolean;
  /** Exact shell command, setting, or value to apply verbatim. */
  command?: string;
  /** How the operator confirms the action took effect. */
  verify?: string;
  /** HTTP(S) URL or repository-relative file path relevant to the action. */
  link?: string;
}

/** Raw agent-provided implementation-decision evidence accepted in a delivery envelope. */
export interface TradeoffMadeInputV1 {
  decision: string;
  alternativesConsidered?: string[];
  rationale: string;
  impact?: string;
}

/**
 * Field bounds of an agent-written deferred-work item (contract v166). An item
 * over a bound, a missing or blank field, an unknown key, or a plain string is
 * rejected with `invalid_input` by `deliver` and `record-work`.
 */
export const DEFERRED_WORK_LIMITS = {
  maxTitleLength: 80,
  maxChangeLength: 400,
  maxLocationLength: 200,
  maxDoneWhenLength: 200
} as const;

/**
 * One recommended objective outside the delivering mission, written by the
 * agent (contract v166). Nothing rewrites it: the delivery composer never sees
 * deferred work, and promotion copies the fields verbatim.
 */
export interface DeferredWorkInputV1 {
  /** Imperative, at most 80 characters. Shown as the row title. */
  title: string;
  /** The specific change that is needed. One or two sentences, at most 400 characters. */
  change: string;
  /** Where to find it: file, function, component, or command. At most 200 characters. */
  location: string;
  /** Concise done criteria: the observable result, one sentence, at most 200 characters. */
  doneWhen: string;
}

/** Authoritative, agent-supplied delivery facts. Omitted arrays normalize to `[]`. */
export interface DeliveryAgentReportInputV1 {
  humanActions?: HumanActionInputV1[];
  tradeoffsMade?: TradeoffMadeInputV1[];
  knownRisks?: string[];
  deferredWork?: DeferredWorkInputV1[];
  assumptions?: string[];
}

/** Newest-first page size for mission delivery and file-change evidence reads. */
export const MISSION_EVIDENCE_LIST_LIMIT = 200;

// ---- Deferred-work resolutions ----

/** The operator's decision on one deferred-work item of a delivery. */
export type HumanActionResolutionStatus = HumanActionResolutionDto['status'];

/**
 * How a deferred-work item was promoted when it was marked `done` (contract v147):
 * into a new mission, or onto the delivering mission as a future objective.
 */
export type HumanActionResolutionOutcome = 'mission_created' | 'objective_added';

// ---- Mission summary (contract v166) ----
//
// Operator surface only. The mission summary and its evidence are never sent
// to agents: `load-context`, the mission packet, hosted and local MCP tools, and
// CLI protocol commands do not expose it. The REST routes below are exempt from
// MCP parity for that reason.

/** Upper bound on `evidence.actions` and on `evidence.sources` in one summary read. */
export const MISSION_SUMMARY_EVIDENCE_LIMIT = 100;

// ---- Mission file changes ----

/**
 * Provenance of a changed path. `declared_edit` means at least one successful
 * native connector observation; `agent_declared` means only an explicit agent
 * declaration (shell/script/generator output, delete, rename, `record-work`).
 * `null` means historical provenance is unknown and must display as Unknown.
 * Native evidence is never downgraded by a later declaration.
 */
export type FileChangeSource = NonNullable<FileChangeDto['source']>;

/** Declared binding between a session and the connector's capture hook. Configuration evidence only. */
export type CaptureBindingState = CaptureSessionDto['bindingState'];

/**
 * Bounded sticky capture gap codes that mean "some tool activity could not be
 * captured as a path". Any other bounded code is retained as health only.
 */
export const CAPTURE_GAP_CODES = [
  'direct_path_unavailable',
  'native_payload_unavailable',
  'outcome_unavailable',
  'outcome_partial',
  'shell_activity_unverified'
] as const;
export type CaptureGapCode = (typeof CAPTURE_GAP_CODES)[number];

export const MAX_CAPTURE_HEALTH_CODES = 16;

/**
 * Objective-level warnings derived across every session of the objective; a
 * newer healthy session never hides an earlier gap. `sync_pending` and
 * `sync_failed` are local-only (see {@link LocalObjectiveChangesDto}).
 */
export type CaptureWarningCode =
  | 'unbound'
  | 'bound_no_callback'
  | 'unknown_binding'
  | 'tool_activity_uncaptured'
  | 'sync_pending'
  | 'sync_failed';

export const CAPTURE_WARNING_MESSAGES: Record<CaptureWarningCode, string> = {
  unbound: 'Automatic file tracking was not active for this session.',
  bound_no_callback: 'File tracking is configured but no callback has been observed.',
  unknown_binding: 'Automatic file tracking availability is unknown.',
  tool_activity_uncaptured:
    'Some tool activity could not be captured; declared paths may be needed.',
  sync_pending: 'Some captured paths have not synchronized.',
  sync_failed: 'Some captured paths have not synchronized.'
};

/** Hard cap on rows returned by every objective file-change read. */
export const OBJECTIVE_FILE_CHANGES_LIMIT = 200;

export type LocalFileChangeSyncState = 'synced' | 'pending';

/** One locally known path; deduplicated by path across matching local sessions. */
export interface LocalFileChangeDto {
  filePath: string;
  source: FileChangeSource;
  observedAt: string;
  hookHealth: string | null;
  syncState: LocalFileChangeSyncState;
}

/**
 * CLI-local read: `ovld protocol changes --objective-id ...` (never sent to the
 * backend). Covers only ledgers of this working directory's locally known
 * sessions for the objective, including pending rows; it is explicitly not
 * complete cross-device objective history. `total` counts distinct paths in that
 * local scope. A call with no matching local session reports
 * `coverage: 'unavailable'`, never "no files changed".
 */
export interface LocalObjectiveChangesDto {
  scope: 'local_objective_sessions';
  objectiveId: string;
  coverage: 'available' | 'unavailable';
  items: LocalFileChangeDto[];
  total: number;
  limit: number;
  truncated: boolean;
  sync: { synced: number; pending: number; failed: boolean };
  capture: {
    bindingState: CaptureBindingState;
    callbackObserved: boolean;
    healthCodes: string[];
  };
  warnings: CaptureWarningCode[];
}

// ---- Agent catalog and launch configuration ----
//
// Shapes follow connectors/docs/agent-harness-configuration-architecture.md:
// the workspace catalog (workspaces.settings_json.agentCatalog) answers "what
// agents and models are offered"; per-user launch mechanics live on the user's
// user_execution_target_preferences row; project_user_preferences remember the
// last selection; objectives.launch_config_json holds explicit per-objective
// overrides keyed by execution target and agent.

export type TerminalSessionStateDto = TerminalSessionDto['lastObservedState'];

export type LocalTargetMutationKindDto = NonNullable<
  ExecutionRequestDto['localTargetMutationKind']
>;

// ---- Realtime feed ----

/** Named SSE events emitted by `GET /realtime` and compatibility `GET /api/stream`. */
export type RealtimeEvent = RealtimeStreamEvent;

// ---- Mobile push registrations ----

/** APNs delivery environment for device and Live Activity token registrations. */
export type DevicePushEnvironment = ApnsEnvironment;

/**
 * Body for `PUT /api/mobile/live-activities/:activityId/push-token`.
 * `environment` and `bundleId` select the APNs host and liveactivity topic per
 * registration — the same fields required for push-to-start and device tokens.
 */
export type LiveActivityPushTokenBody = RegisterLiveActivityPushTokenBody;

// ---- Inbox missions triage (coo:826 / coo:844 / coo:858, contract v124) ---
//
// Bounded cross-workspace projection for the Inbox page: agent-authored
// missions still in status type `next`, unioned with missions of any creator
// that are past due or due today or tomorrow. Human-created missions without a
// due date that has arrived never appear here; unallocated captures use
// profile-owned `/api/inbox`. Same membership / mission:read rule as My
// Missions and the activity feed.

/** Why a mission appears in `GET /api/inbox/missions`. */
export type InboxMissionReason = InboxMissionDto['reasons'][number];

// ---- Feed page activity (coo:757, coo:826) --------------------------------
//
// One bounded projection of live and recently delivered work across every
// workspace the caller actively belongs to in the active organization — the
// active membership and mission-read permission in each workspace. The feed is
// mission-anchored: a mission is one card listing all of its objectives,
// alongside the blocking questions waiting on a person. Open vocabulary: a
// client that does not recognize a `kind` renders nothing for that item rather
// than failing, so adding a kind stays additive.

export type ActivityFeedItemKind = ActivityFeedItemDto['kind'];

export type ActivityFeedItemDto = ActivityFeedDto['items'][number];

// ---- Uploads (core upload service) ----

/**
 * Lifecycle of a stored object's bytes (`attachments.upload_status` /
 * `objective_attachments.upload_status`). Local uploads land as `available`.
 */
export type AttachmentUploadStatus = 'prepared' | 'uploaded' | 'available' | 'failed' | 'deleted';

export type ApiError = ErrorEnvelope;

// ---- Webhooks (coo:115) ----------------------------------------------------

/** Returned by rotate-secret; the previous secret stops verifying immediately. */
export type RotateWebhookSecretResultDto = CreateWebhookSubscriptionResultDto;

// ---- Virtual execution targets (coo:258, contract v3) ----------------------
//
// Provider-neutral virtual execution targets: a selectable Overlord target that
// a gateway (Racecar first) realizes only after it claims an existing execution
// request over the documented `/api/virtual-targets/v1/*` REST surface. These
// DTOs are the stable, versioned contract shared by the REST server, the SPA,
// and — vendored as a public subset — an external `rest-consumer` gateway. See
// the Virtual Target Queue Surface in contract/architecture.md and the Virtual Execution
// Targets section of the schema contract.
//
// Invariants encoded here: the queue payload is immutable and returned only to
// the authenticated claiming gateway; it carries opaque handles and grant
// *references*, never filesystem paths or raw secrets; preparation is
// append-only observation data, never a new `execution_requests.status`.

/** Gateway health as reported through registration/heartbeat. */
export type VirtualTargetHealth = 'healthy' | 'degraded' | 'unreachable' | 'unknown';

/** Source input kinds a gateway can materialize. Open (namespaced) beyond these. */
export type VirtualSourceKind = 'git' | 'local_checkout' | 'source_bundle' | (string & {});

/** Append-only observation kinds recorded under a request. */
export type VirtualObservationKind =
  | 'progress'
  | 'launch'
  | 'failure'
  | 'lifecycle_resource'
  | (string & {});

/** Opaque grant kinds. Values are references/scopes only — never bearer secrets. */
export type VirtualGrantKind =
  | 'launch'
  | 'attachment'
  | 'download'
  | 'credential_reference'
  | (string & {});

/** Per-resource source-compatibility result surfaced to UI/agent context. */
export type VirtualSourceCompatibility = 'compatible' | 'degraded' | 'incompatible';

/** Phase a typed failure occurred in. */
export type VirtualFailurePhase = 'claim' | 'source' | 'environment' | 'launch' | (string & {});

/** Delegated lifecycle actions a UI may request against a virtual target. */
export type VirtualTargetActionKind =
  | 'start'
  | 'stop'
  | 'archive'
  | 'delete'
  | 'enqueue'
  | 'retry'
  | 'dequeue';

/** Advertised gateway/target capabilities (non-secret). */
export interface VirtualTargetCapabilitiesDto {
  /** Whether the target can consume an opaque `local_checkout` source. */
  localCheckoutSource: boolean;
  /** Whether the target can fetch an uploaded `source_bundle`. */
  sourceBundleSource: boolean;
  /** Whether the target can proxy a browser terminal (later, separately authorized). */
  browserTerminal: boolean;
  /** Additional namespaced capability hints. */
  [capability: string]: boolean | undefined;
}

/**
 * Body for `PUT /api/virtual-targets/v1/registration`. Registers or refreshes
 * exactly one selected virtual target and serves as its heartbeat. Secrets are
 * never included; gateway credentials are configured out of band.
 */
export interface VirtualTargetRegistrationBody {
  executionTargetId: string;
  /** Namespaced adapter key (e.g. `racecar`); identifies the gateway, not a target type. */
  gatewayKey: string;
  /** Stable per-installation gateway identity; a match replaces (not duplicates) the registration. */
  gatewayInstanceId: string;
  gatewayVersion?: string | null;
  capabilities: VirtualTargetCapabilitiesDto;
  /** Agent identifiers this gateway can launch. */
  supportedAgents: string[];
  /** Queue schema versions the gateway understands (e.g. `["v1"]`). */
  supportedQueueVersions: string[];
  /** Non-secret gateway configuration echoed back to operators. */
  connection?: Record<string, unknown>;
}

/** Read model of a registered virtual target (no secrets). */
export interface VirtualTargetRegistrationDto {
  executionTargetId: string;
  gatewayKey: string;
  gatewayInstanceId: string;
  gatewayVersion: string | null;
  capabilities: VirtualTargetCapabilitiesDto;
  supportedAgents: string[];
  supportedQueueVersions: string[];
  health: VirtualTargetHealth;
  lastHeartbeatAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A typed source descriptor inside a queue item. Carries a credential-reference
 * ID and/or opaque target-relative handle — never a raw token or a
 * server-readable filesystem path.
 */
export interface VirtualSourceDescriptorV1 {
  kind: VirtualSourceKind;
  /** `git`: repository URL the gateway clones (credential resolved via `credentialRef`). */
  url?: string;
  /** `git`: branch/ref to materialize. */
  ref?: string;
  /** `git`: exact commit to check out, when pinned. */
  commit?: string;
  /** Reference ID for a credential the gateway exchanges via a grant; never the secret itself. */
  credentialRef?: string | null;
  /** `local_checkout`: opaque, target-relative handle. Never a readable path. */
  targetRelativeRef?: string | null;
  /** `source_bundle`: opaque download handle exchanged via a grant. */
  bundleRef?: string | null;
  /** Observed content digest for drift detection, when known. */
  observedContentDigest?: string | null;
}

/** A project resource as carried in the immutable queue item. */
export interface VirtualProjectResourceV1 {
  resourceId: string;
  resourceKey: string;
  label: string | null;
  source: VirtualSourceDescriptorV1;
  /** True only for the single active resource that seeds the initial working directory. */
  active: boolean;
}

/** A required source input that must be satisfiable or launch is blocked. */
export interface VirtualSourceRequirementV1 {
  resourceKey: string;
  kind: VirtualSourceKind;
  /** Human-safe description of why this source is required. */
  reason: string;
}

/** A non-blocking informational reference preserved for agent context. */
export interface VirtualInformationalReferenceV1 {
  resourceKey: string;
  compatibility: VirtualSourceCompatibility;
  /** Bounded, redacted excerpt preserved for agent context. */
  excerpt: string | null;
}

/** The immutable desired environment referenced by a queue item. */
export interface VirtualEnvironmentV1 {
  definitionId: string;
  version: number;
  /** Stable fingerprint across lockfiles/resources. */
  fingerprint: string;
  /** SHA-256 over the canonical environment definition. */
  digest: string;
}

/** An opaque, request-scoped grant reference handed to the claiming gateway. */
export interface VirtualGrantReferenceV1 {
  grantId: string;
  kind: VirtualGrantKind;
  expiresAt: string;
}

/**
 * `VirtualExecutionQueueItemV1` — the exact versioned, immutable payload returned
 * only to the authenticated claiming gateway. Its canonical JSON and SHA-256
 * digest are persisted when the request is queued and never rebuilt from mutable
 * rows at retry time.
 */
export interface VirtualExecutionQueueItemV1 {
  schemaVersion: 'v1';
  executionRequestId: string;
  executionTargetId: string;
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string;
  /** Immutable desired environment for this request. */
  environment: VirtualEnvironmentV1;
  /** Every project resource; exactly one is `active`. */
  resources: VirtualProjectResourceV1[];
  /** Resource key of the single active resource (initial directory). */
  activeResourceKey: string;
  /** Required source inputs that block launch when unsatisfiable. */
  sourceRequirements: VirtualSourceRequirementV1[];
  /** Non-blocking informational references preserved for agent context. */
  informationalReferences: VirtualInformationalReferenceV1[];
  /** Agent + model + reasoning to launch. */
  agent: string;
  model: string | null;
  reasoningEffort: string | null;
  /** Resolved launch-config snapshot (flags/pre-command). */
  launchConfig: AgentLaunchConfigDto;
  /** Only request-scoped grant *references*; no bearer values. */
  grants: VirtualGrantReferenceV1[];
  /** SHA-256 of this payload's canonical JSON; echoed at `launched` for verification. */
  payloadDigest: string;
}

/** Body for `POST /api/virtual-targets/v1/claim`. */
export interface VirtualTargetClaimBody {
  executionTargetId: string;
  gatewayInstanceId: string;
}

/**
 * Response to a successful claim. Replaying the same gateway+request returns the
 * same `claimId` and `queueItem`.
 */
export interface VirtualTargetClaimResponseDto {
  claimId: string;
  expiresAt: string;
  queueItem: VirtualExecutionQueueItemV1;
}

/**
 * Body for `POST /api/virtual-targets/v1/requests/:id/progress`. Bounded and
 * monotonic; does not transition status. `sequence` makes it idempotent.
 */
export interface VirtualTargetProgressObservationBody {
  claimId: string;
  sequence: number;
  /** Short preparation stage identifier (e.g. `cloning`, `building`). */
  stage: string;
  /** Bounded, redacted human-safe message. */
  message?: string | null;
  /** Optional 0–100 progress hint. */
  percent?: number | null;
  observedAt: string;
}

/**
 * Body for `POST /api/virtual-targets/v1/requests/:id/launched`. Records the
 * launch observation and drives the `launching → launched` transition exactly
 * once. `payloadDigest` must match the claimed snapshot.
 */
export interface VirtualTargetLaunchObservationV1 {
  claimId: string;
  sequence: number;
  /** Must equal the claimed `VirtualExecutionQueueItemV1.payloadDigest`. */
  payloadDigest: string;
  /** Opaque external run/environment identifiers the gateway realized. */
  externalRunId?: string | null;
  externalEnvironmentId?: string | null;
  observedAt: string;
}

/**
 * Body for `POST /api/virtual-targets/v1/requests/:id/failed`. Typed and
 * redacted; `retryable` informs retry policy but does not itself requeue.
 */
export interface VirtualTargetFailureV1 {
  claimId: string;
  sequence: number;
  /** Typed failure code (open vocabulary, e.g. `source_incompatible`). */
  failureCode: string;
  failurePhase: VirtualFailurePhase;
  retryable: boolean;
  /** Bounded, redacted human-safe summary. */
  message?: string | null;
  observedAt: string;
}

/** Body for `POST /api/virtual-targets/v1/grants/:id/exchange`. */
export interface VirtualGrantExchangeBody {
  claimId: string;
  gatewayInstanceId: string;
}

/**
 * Result of a grant exchange. Returns narrowly scoped, short-lived material
 * bound to the request/target/gateway — never the user's Overlord token.
 */
export interface VirtualGrantExchangeResultDto {
  grantId: string;
  kind: VirtualGrantKind;
  expiresAt: string;
  /** For `download`/`attachment` grants: a scoped, expiring URL. */
  downloadUrl?: string | null;
  /** For `credential_reference` grants: scoped, short-lived credential material. */
  credential?: Record<string, unknown> | null;
}

/**
 * Summarized external lifecycle resource (`mission_target_resources`) surfaced to
 * mission views. References opaque external IDs only.
 */
export interface MissionTargetResourceDto {
  id: string;
  missionId: string;
  executionTargetId: string;
  /** Adapter resource kind (`car`, `environment`, `run`, …). */
  kind: string;
  /** Opaque external identifier; never a path or secret. */
  externalId: string;
  /** Summarized, bounded adapter state. */
  state: string;
  /** Latest summarized observation for the mission view. */
  latestObservation: unknown | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /api/virtual-targets/v1/missions/:id/resources` response: reusable
 * car/environment/run summaries plus per-resource source-compatibility.
 */
export interface VirtualTargetMissionResourcesDto {
  resources: MissionTargetResourceDto[];
  sourceCompatibility: VirtualInformationalReferenceV1[];
}

/**
 * Body for `POST /api/virtual-targets/v1/missions/:id/actions`. Authorizes a
 * single delegated lifecycle action; destructive kinds require `confirm`.
 */
export interface VirtualTargetActionBody {
  executionTargetId: string;
  action: VirtualTargetActionKind;
  /** Target the action at a specific external resource, when applicable. */
  externalResourceId?: string | null;
  /** Required acknowledgement for destructive actions (`delete`, `archive`). */
  confirm?: boolean;
}

/**
 * Result of a delegated action. The action's outcome is recorded as an
 * observation; it can never change mission completion.
 */
export interface VirtualTargetActionResultDto {
  action: VirtualTargetActionKind;
  /** Whether the target accepted the delegated action. */
  accepted: boolean;
  /** `synchronous` when applied immediately, `queued` when deferred to async work. */
  disposition: 'synchronous' | 'queued';
  /** The observation recorded for this action, when produced synchronously. */
  observation?: MissionTargetResourceDto | null;
}
