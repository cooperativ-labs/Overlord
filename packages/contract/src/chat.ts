/**
 * Overlord assistant (chat) REST, event, and notification contract (coo:1108,
 * contract v152).
 *
 * Every chat resource is private to one owner profile inside one organization.
 * Requests for another owner's thread, run, question, proposal, notification,
 * or connection return 404 without revealing existence. Chat is Cloud-only;
 * a Local backend answers every `/api/chat/*` route with 404 `chat_unavailable`
 * and clients render an unavailable state.
 *
 * Private provider state (Gemini response parts, thought signatures, call IDs),
 * raw tool results, credentials, and OAuth material never appear in any type in
 * this file, in realtime, or in logs.
 */

// ---------------------------------------------------------------------------
// Controlled vocabularies (closed; adding a value requires a contract bump)
// ---------------------------------------------------------------------------

export const CHAT_RUN_STATES = [
  'queued',
  'running',
  'waiting_user',
  'completed',
  'failed',
  'cancelled'
] as const;
export type ChatRunState = (typeof CHAT_RUN_STATES)[number];

/** A thread has at most one run in one of these states. */
export const CHAT_UNFINISHED_RUN_STATES = ['queued', 'running', 'waiting_user'] as const;

/**
 * Terminal outcome of a run. `answered` is a normal completion; `allowance_exhausted`
 * completes with a partial summary and makes Continue available.
 */
export const CHAT_RUN_OUTCOMES = ['answered', 'allowance_exhausted'] as const;
export type ChatRunOutcome = (typeof CHAT_RUN_OUTCOMES)[number];

/** Typed run failures. Tool failures are reported per tool call, never here. */
export const CHAT_RUN_FAILURE_CODES = [
  'provider_unavailable',
  'rate_limited',
  'context_limit',
  'unsupported_capability',
  'interrupted',
  'provider_error',
  'source_access_lost'
] as const;
export type ChatRunFailureCode = (typeof CHAT_RUN_FAILURE_CODES)[number];

export const CHAT_ATTEMPT_STATES = [
  'leased',
  'released',
  'succeeded',
  'failed',
  'fenced',
  'cancelled'
] as const;
export type ChatAttemptState = (typeof CHAT_ATTEMPT_STATES)[number];

/** How an attempt began: first try, provider-checkpoint resume, or explicit fresh generation. */
export const CHAT_RECOVERY_MODES = ['initial', 'checkpoint', 'fresh_generation'] as const;
export type ChatRecoveryMode = (typeof CHAT_RECOVERY_MODES)[number];

export const CHAT_MESSAGE_ROLES = ['user', 'assistant'] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

export const CHAT_MESSAGE_STATES = ['streaming', 'complete', 'interrupted'] as const;
export type ChatMessageState = (typeof CHAT_MESSAGE_STATES)[number];

export const CHAT_QUESTION_STATES = ['open', 'answered', 'superseded', 'cancelled'] as const;
export type ChatQuestionState = (typeof CHAT_QUESTION_STATES)[number];

export const CHAT_PROPOSAL_STATES = ['open', 'created', 'cancelled'] as const;
export type ChatProposalState = (typeof CHAT_PROPOSAL_STATES)[number];

export const CHAT_SOURCE_KINDS = ['knowledgebase', 'overlord', 'repository'] as const;
export type ChatSourceKind = (typeof CHAT_SOURCE_KINDS)[number];

/** Result of the most recent live access check for one source. Anything but `authorized` fails closed. */
export const CHAT_SOURCE_ACCESS_STATES = ['authorized', 'revoked', 'unknown'] as const;
export type ChatSourceAccessState = (typeof CHAT_SOURCE_ACCESS_STATES)[number];

export const CHAT_TOOL_CALL_STATES = [
  'requested',
  'executing',
  'completed',
  'failed',
  'cancelled'
] as const;
export type ChatToolCallState = (typeof CHAT_TOOL_CALL_STATES)[number];

/** Persisted, ordered event kinds on the private per-thread channel. */
export const CHAT_EVENT_KINDS = [
  'thread.updated',
  'message.created',
  'message.delta',
  'message.completed',
  'run.updated',
  'tool.updated',
  'question.opened',
  'question.closed',
  'proposal.revised',
  'proposal.created',
  'content.invalidated'
] as const;
export type ChatEventKind = (typeof CHAT_EVENT_KINDS)[number];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Error codes returned in `{ error, code }` bodies. Status codes: `chat_unavailable`
 * 404; `not_found` 404; `run_in_progress` 409; `stale_revision` 409; `snapshot_required`
 * 409 (or a `snapshot_required` frame on an open stream); `proposal_not_creatable` 409;
 * `continue_not_available` 409; `source_access_lost` 409; `provider_not_ready` 503;
 * `connection_reauthorization_required` 409; `limit_exceeded` 429; `invalid_request` 400.
 * Account connections (v153) add `credential_rejected` 422 (the upstream refused an API
 * key), `provider_not_available` 404 (this provider is not offered here), and
 * `provider_unavailable` 502 (the upstream could not be reached).
 */
export const CHAT_ERROR_CODES = [
  'chat_unavailable',
  'not_found',
  'invalid_request',
  'run_in_progress',
  'stale_revision',
  'snapshot_required',
  'proposal_not_creatable',
  'continue_not_available',
  'source_access_lost',
  'provider_not_ready',
  'connection_reauthorization_required',
  'limit_exceeded',
  'credential_rejected',
  'provider_not_available',
  'provider_unavailable'
] as const;
export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

export interface ChatErrorDto {
  error: string;
  code: ChatErrorCode;
}

// ---------------------------------------------------------------------------
// Limits (configurable; these are the contracted defaults)
// ---------------------------------------------------------------------------

export const CHAT_DEFAULT_LIMITS = {
  /** Fixed invariant, not configurable. */
  unfinishedRunsPerThread: 1,
  concurrentRunsPerOwner: 3,
  toolCallsPerRun: 60,
  /** Active processing, excluding time spent in `waiting_user`. */
  activeProcessingMsPerRun: 10 * 60 * 1000,
  concurrentTargetReadsPerRun: 4,
  /** Renewable worker lease on an attempt. */
  attemptLeaseMs: 30 * 1000,
  /** Notification grace period before a candidate becomes due. */
  notificationGraceMs: 5 * 1000,
  /** Foreground presence expiry; clients renew before it lapses. */
  presenceTtlMs: 30 * 1000,
  /** Event replay retention: whichever bound is reached first advances the boundary. */
  eventRetentionMs: 7 * 24 * 60 * 60 * 1000,
  eventRetentionCount: 5000,
  /** Bounded sanitized title used in notifications and lists. */
  titleMaxChars: 80,
  messageMaxChars: 16_000
} as const;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/**
 * Every block carries `fallbackText` so a client that does not know a kind can
 * still render something. Unknown kinds must be tolerated and rendered as text.
 */
interface ChatBlockBase {
  id: string;
  fallbackText: string;
}

export interface ChatTextBlockDto extends ChatBlockBase {
  kind: 'text';
  /** Markdown, rendered as safe Markdown. Citations reference `evidenceIds`. */
  text: string;
  evidenceIds: string[];
}

export interface ChatEvidenceBlockDto extends ChatBlockBase {
  kind: 'evidence';
  evidence: ChatEvidenceDto[];
}

export interface ChatQuestionBlockDto extends ChatBlockBase {
  kind: 'question';
  questionId: string;
}

export interface ChatProposalBlockDto extends ChatBlockBase {
  kind: 'proposal';
  proposalId: string;
  revision: number;
}

/** A live reference to a mission or objective; permissions are rechecked on every read. */
export interface ChatMissionBlockDto extends ChatBlockBase {
  kind: 'mission';
  missionId: string;
  objectiveId: string | null;
}

/** Replaces any block whose source dependencies are no longer authorized. */
export interface ChatUnavailableBlockDto extends ChatBlockBase {
  kind: 'unavailable';
  reason: 'source_access_lost';
  regenerable: boolean;
}

export type ChatBlockDto =
  | ChatTextBlockDto
  | ChatEvidenceBlockDto
  | ChatQuestionBlockDto
  | ChatProposalBlockDto
  | ChatMissionBlockDto
  | ChatUnavailableBlockDto;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Where an evidence reference came from. Never an absolute path or credential. */
export type ChatSourceLocatorDto =
  | {
      kind: 'knowledgebase';
      connectionId: string;
      workspace: string;
      nodeId: string;
      path: string | null;
    }
  | {
      kind: 'overlord';
      entityType: 'project' | 'resource' | 'mission' | 'objective' | 'delivery';
      entityId: string;
      projectId: string | null;
    }
  | {
      kind: 'repository';
      executionTargetId: string;
      projectId: string;
      resourceKey: string;
      /** Repository-relative path, or null for resource-level observations (status, diff). */
      relativePath: string | null;
      head: string | null;
    };

export interface ChatEvidenceDto {
  id: string;
  source: ChatSourceLocatorDto;
  /** Version id, ETag, HEAD, or revision where the source provides one. */
  sourceRevision: string | null;
  observedAt: string;
  label: string;
  excerpt: string | null;
  truncated: boolean;
  /** True when the observation is older than the client should treat as current. */
  stale: boolean;
}

// ---------------------------------------------------------------------------
// Threads, messages, runs
// ---------------------------------------------------------------------------

export interface ChatThreadDto {
  id: string;
  organizationId: string;
  title: string;
  titleSource: 'pending' | 'generated' | 'user';
  archivedAt: string | null;
  lastActivityAt: string;
  /** Present when the thread has an unfinished run. */
  activeRunState: Extract<ChatRunState, 'queued' | 'running' | 'waiting_user'> | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ChatThreadListResponse {
  items: ChatThreadDto[];
  /** Opaque cursor for the next page, or null. */
  nextCursor: string | null;
}

export interface ChatMessageDto {
  id: string;
  threadId: string;
  role: ChatMessageRole;
  state: ChatMessageState;
  blocks: ChatBlockDto[];
  runId: string | null;
  /** Set on a user message that answered a question. */
  answersQuestionId: string | null;
  clientRequestId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ChatRunUsageDto {
  toolCalls: number;
  activeProcessingMs: number;
  gatheredContentBytes: number;
}

/**
 * An explicit, per-request authorization for the assistant to write to one Knowledgebase
 * workspace through one of the caller's connections (contract v154). Without it a run is
 * research only: no write tool is offered and every write is refused server-side.
 */
export interface ChatKnowledgebaseWriteDto {
  connectionId: string;
  /** Knowledgebase workspace slug; must be in the connection's `authorizedWorkspaces`. */
  workspace: string;
}

export interface ChatRunDto {
  id: string;
  threadId: string;
  triggerMessageId: string;
  state: ChatRunState;
  outcome: ChatRunOutcome | null;
  failureCode: ChatRunFailureCode | null;
  /** Only `allowance_exhausted` completions on the thread's latest run offer Continue. */
  continueAvailable: boolean;
  continuedFromRunId: string | null;
  /** The Knowledgebase write scope the user granted this run (v154); null for research only. */
  knowledgebaseWrite: ChatKnowledgebaseWriteDto | null;
  usage: ChatRunUsageDto;
  cancelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  revision: number;
}

export interface ChatQuestionOptionDto {
  id: string;
  label: string;
}

/** Same shape the existing question and choice cards render. */
export interface ChatQuestionDto {
  id: string;
  threadId: string;
  runId: string;
  /** 1-based ordinal of this question within its run; notifications dedupe on it. */
  ordinal: number;
  state: ChatQuestionState;
  prompt: string;
  options: ChatQuestionOptionDto[];
  allowFreeText: boolean;
  answerMessageId: string | null;
  createdAt: string;
  answeredAt: string | null;
  revision: number;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** Frozen at proposal preparation; Create passes it verbatim and verifies what was saved. */
export interface ChatAssignmentDto {
  agent: string;
  model: string | null;
  reasoningEffort: string | null;
  /** Where the selection came from, shown on the card. */
  source: 'project_default' | 'user_preference' | 'assistant_selection';
}

export interface ChatProposalObjectiveDto {
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  resourceKey: string;
  assignment: ChatAssignmentDto;
  evidenceIds: string[];
}

export interface ChatProposalMissionDto {
  /** Stable within a proposal across revisions so clients can diff. */
  key: string;
  projectId: string;
  /** Snapshot for display; authorization is by `projectId`. */
  projectName: string;
  workspaceId: string;
  title: string;
  objectives: ChatProposalObjectiveDto[];
  dependencies: string[];
  /** Set when the destination audience is broader than a cited source's audience. */
  audienceWarning: string | null;
}

export interface ChatProposalRevisionDto {
  revision: number;
  missions: ChatProposalMissionDto[];
  /** Acting user is the responsible person in every destination workspace. */
  responsibleProfileId: string;
  invalidated: boolean;
  createdAt: string;
}

export interface ChatProposalDto {
  id: string;
  threadId: string;
  state: ChatProposalState;
  currentRevision: number;
  current: ChatProposalRevisionDto;
  receipt: ChatCreationReceiptDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatCreatedMissionDto {
  missionId: string;
  missionDisplayId: string;
  projectId: string;
  objectiveIds: string[];
}

/** One durable receipt per proposal; every replay of Create returns it unchanged. */
export interface ChatCreationReceiptDto {
  id: string;
  proposalId: string;
  revision: number;
  missions: ChatCreatedMissionDto[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Snapshot and events
// ---------------------------------------------------------------------------

/**
 * Atomic snapshot. Everything here and `eventCursor` are read in one database
 * transaction, so subscribing with `after = eventCursor` neither misses nor
 * double-applies an event. Content whose dependencies are not currently
 * authorized is already replaced with `unavailable` blocks.
 */
export interface ChatThreadSnapshotDto {
  thread: ChatThreadDto;
  messages: ChatMessageDto[];
  /** True when older messages exist; page with `before`. */
  hasEarlierMessages: boolean;
  activeRun: ChatRunDto | null;
  /** The thread's most recent terminal run, for Continue and failure display. */
  latestRun: ChatRunDto | null;
  openQuestion: ChatQuestionDto | null;
  openProposals: ChatProposalDto[];
  /**
   * Proposals that are no longer open (created or cancelled) but are referenced by a
   * proposal block in `messages`, so a client can render their receipt or final state
   * after a reload. Same authorized projection as `openProposals`.
   */
  referencedProposals: ChatProposalDto[];
  eventCursor: number;
  /** Oldest sequence still replayable; `after` below `retainedFromSeq - 1` is `snapshot_required`. */
  retainedFromSeq: number;
}

interface ChatEventBase {
  threadId: string;
  /** Strictly increasing per thread, gap-free in storage. */
  seq: number;
  createdAt: string;
}

export type ChatEventDto =
  | (ChatEventBase & { kind: 'thread.updated'; thread: ChatThreadDto })
  | (ChatEventBase & { kind: 'message.created'; message: ChatMessageDto })
  | (ChatEventBase & {
      kind: 'message.delta';
      messageId: string;
      blockId: string;
      /** Coalesced text appended to the block. */
      text: string;
    })
  | (ChatEventBase & { kind: 'message.completed'; message: ChatMessageDto })
  | (ChatEventBase & { kind: 'run.updated'; run: ChatRunDto })
  | (ChatEventBase & {
      kind: 'tool.updated';
      runId: string;
      toolCallId: string;
      /** Sanitized, user-facing label such as "Reading OverlordMobile git status". */
      label: string;
      state: ChatToolCallState;
    })
  | (ChatEventBase & { kind: 'question.opened'; question: ChatQuestionDto })
  | (ChatEventBase & { kind: 'question.closed'; question: ChatQuestionDto })
  | (ChatEventBase & { kind: 'proposal.revised'; proposal: ChatProposalDto })
  | (ChatEventBase & { kind: 'proposal.created'; proposal: ChatProposalDto })
  | (ChatEventBase & {
      kind: 'content.invalidated';
      /** Clients replace these from a fresh authorized snapshot. */
      messageIds: string[];
      proposalIds: string[];
    });

/**
 * Stream frames on `GET /api/chat/threads/:id/events` (SSE). `event` frames carry
 * a `ChatEventDto`; `snapshot_required` means the cursor is older than retention
 * or the projection changed and the client must reload the snapshot; `heartbeat`
 * keeps intermediaries open. A closed stream never implies run completion.
 */
export type ChatStreamFrameDto =
  | { type: 'event'; event: ChatEventDto }
  | { type: 'snapshot_required'; retainedFromSeq: number }
  | { type: 'heartbeat'; at: string };

/** Polling fallback: same events as the stream, bounded page. */
export interface ChatEventPageDto {
  events: ChatEventDto[];
  /** Cursor to pass as `after` next time. */
  cursor: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface CreateChatThreadBody {
  /** Optional first message; when present the response includes the created run. */
  message?: SubmitChatMessageBody;
}

export interface CreateChatThreadResponse {
  thread: ChatThreadDto;
  message: ChatMessageDto | null;
  run: ChatRunDto | null;
}

export interface UpdateChatThreadBody {
  expectedRevision: number;
  title?: string;
  archived?: boolean;
}

/**
 * Idempotent per `(thread, clientRequestId)`. While a question is open the message
 * is its answer and resumes the same run. While a run is queued or running the
 * request is rejected with `run_in_progress`.
 */
export interface SubmitChatMessageBody {
  clientRequestId: string;
  text: string;
  /** When answering through a card option. Ignored unless it names an option of the open question. */
  optionId?: string;
  /**
   * Authorizes Knowledgebase writes for the run this message starts (v154). The
   * connection must be the caller's, connected, and authorized for the workspace
   * (`invalid_request` otherwise; `connection_reauthorization_required` when it needs
   * sign-in). An answer may add a grant to a waiting run that has none; a different
   * grant is `invalid_request`. A continued run inherits its source run's grant.
   */
  knowledgebaseWrite?: ChatKnowledgebaseWriteDto | null;
}

export interface SubmitChatMessageResponse {
  message: ChatMessageDto;
  run: ChatRunDto;
  /** True when this request replayed an earlier submission with the same client request id. */
  replayed: boolean;
}

/** Revision-checked answer from a question card. */
export interface AnswerChatQuestionBody {
  clientRequestId: string;
  expectedRevision: number;
  optionId?: string;
  text?: string;
}

export interface CancelChatRunBody {
  clientRequestId: string;
}

/** Continue an `allowance_exhausted` run with a fresh allowance and the gathered evidence. */
export interface ContinueChatRunBody {
  clientRequestId: string;
}

/**
 * The sole creation path. Idempotent per `(owner, clientRequestId)` and unique per
 * proposal: every replay, concurrent duplicate, or later call returns the same receipt.
 */
export interface CreateFromChatProposalBody {
  clientRequestId: string;
  expectedRevision: number;
}

export interface CreateFromChatProposalResponse {
  proposal: ChatProposalDto;
  receipt: ChatCreationReceiptDto;
  replayed: boolean;
}

/** Renew or release one client's foreground presence on a thread. */
export interface UpdateChatPresenceBody {
  clientId: string;
  platform: 'ios' | 'web' | 'desktop';
  state: 'foreground' | 'released';
}

export interface ChatPresenceDto {
  clientId: string;
  expiresAt: string | null;
}

/**
 * Acknowledges that this foreground client rendered every event up to and including
 * `seq`. Idempotent and monotonic per client; it is not a replay cursor.
 */
export interface AckChatEventsBody {
  clientId: string;
  seq: number;
}

export interface ChatAckDto {
  clientId: string;
  ackedSeq: number;
  suppressedNotificationIds: string[];
}

export interface ChatProviderReadinessDto {
  provider: 'gemini';
  model: string;
  state: 'ready' | 'not_configured' | 'unavailable' | 'rate_limited';
  checkedAt: string;
}

export interface ChatProvidersResponse {
  providers: ChatProviderReadinessDto[];
  connections: AccountConnectionDto[];
}

// ---------------------------------------------------------------------------
// Conversation notifications
// ---------------------------------------------------------------------------

/**
 * Conversation notification types. They join the shared preference catalog
 * (`notification_preferences.type`) but are addressed by owner, organization,
 * and thread rather than workspace and mission, and they never appear in the
 * mission-only `GET /api/notifications` list.
 */
export const CHAT_NOTIFICATION_TYPES = ['chat_needs_answer', 'chat_finished'] as const;
export type ChatNotificationType = (typeof CHAT_NOTIFICATION_TYPES)[number];

export const CHAT_NOTIFICATION_CATALOG = {
  chat_needs_answer: {
    id: 'chat_needs_answer',
    label: 'Assistant needs an answer',
    detail: 'The assistant asked you a question.',
    verb: 'needs your answer',
    defaultMode: 'alert',
    transports: ['apns', 'realtime', 'in_app'],
    icon: 'questionmark.bubble.fill'
  },
  chat_finished: {
    id: 'chat_finished',
    label: 'Assistant finished',
    detail: 'The assistant finished or could not finish a request.',
    verb: 'finished',
    defaultMode: 'alert',
    transports: ['apns', 'realtime', 'in_app'],
    icon: 'bubble.left.and.text.bubble.right.fill'
  }
} as const;

export const CHAT_NOTIFICATION_STATES = [
  'pending',
  'suppressed',
  'dispatching',
  'dispatched',
  'cancelled',
  'failed'
] as const;
export type ChatNotificationState = (typeof CHAT_NOTIFICATION_STATES)[number];

/** History projection of a dispatched conversation notification. No transcript content. */
export interface ChatNotificationDto {
  id: string;
  type: ChatNotificationType;
  organizationId: string;
  threadId: string;
  runId: string;
  questionId: string | null;
  /** Bounded, sanitized thread title captured at dispatch. */
  threadTitle: string;
  createdAt: string;
  dispatchedAt: string;
  readAt: string | null;
  revision: number;
}

export interface ChatNotificationListResponse {
  items: ChatNotificationDto[];
  unreadCount: number;
}

export interface MarkChatNotificationReadBody {
  expectedRevision: number;
}

/** Deep link carried by a conversation push; opens the thread, including on cold start. */
export const CHAT_NOTIFICATION_DEEP_LINK = 'overlord://chat/threads/:threadId' as const;

// ---------------------------------------------------------------------------
// Account connections
// ---------------------------------------------------------------------------

export const ACCOUNT_CONNECTION_PROVIDERS = ['knowledgebase', 'everhour', 'github'] as const;
export type AccountConnectionProvider = (typeof ACCOUNT_CONNECTION_PROVIDERS)[number];

/**
 * `organization`: owned by a profile inside one organization (Knowledgebase).
 * `profile`: owned by the profile across every organization (Everhour, GitHub).
 */
export const ACCOUNT_CONNECTION_SCOPES = ['organization', 'profile'] as const;
export type AccountConnectionScope = (typeof ACCOUNT_CONNECTION_SCOPES)[number];

export const ACCOUNT_CONNECTION_CREDENTIAL_KINDS = ['oauth', 'api_key'] as const;
export type AccountConnectionCredentialKind = (typeof ACCOUNT_CONNECTION_CREDENTIAL_KINDS)[number];

/** Server-side envelope formats (never projected); listed for the closed vocabulary. */
export const ACCOUNT_CONNECTION_CREDENTIAL_FORMATS = [
  'connection-v1',
  'everhour-user-key-v1',
  'github-user-oauth-v1'
] as const;
export type AccountConnectionCredentialFormat =
  (typeof ACCOUNT_CONNECTION_CREDENTIAL_FORMATS)[number];

export const ACCOUNT_CONNECTION_STATES = [
  'pending',
  'connected',
  'reauthorization_required',
  'disconnected'
] as const;
export type AccountConnectionState = (typeof ACCOUNT_CONNECTION_STATES)[number];

/**
 * How far the assistant may write through a Knowledgebase connection (v158).
 * `per_request` (default): only the one workspace a user allows on a single message
 * (`knowledgebaseWrite`, v154). `all_workspaces`: reads and writes in every workspace
 * in `authorizedWorkspaces`, for every run, without a per-message grant. Always
 * `per_request` for other providers.
 */
export const ACCOUNT_CONNECTION_ASSISTANT_WRITE_SCOPES = ['per_request', 'all_workspaces'] as const;
export type AccountConnectionAssistantWriteScope =
  (typeof ACCOUNT_CONNECTION_ASSISTANT_WRITE_SCOPES)[number];

/** Non-secret connection metadata. Credentials never leave the connections module. */
export interface AccountConnectionDto {
  id: string;
  provider: AccountConnectionProvider;
  /** Always a string in the default (organization-scoped) listing; null when `scope` is `profile`. */
  organizationId: string | null;
  scope: AccountConnectionScope;
  credentialKind: AccountConnectionCredentialKind;
  /** The upstream account this credential authenticates as, when known. */
  account: { id: string | null; label: string | null; avatarUrl: string | null } | null;
  /** Granted OAuth scopes; empty for API keys. */
  scopes: string[];
  lastValidatedAt: string | null;
  serverUrl: string;
  state: AccountConnectionState;
  /** Provider workspaces this grant can read, e.g. Knowledgebase workspace slugs. */
  authorizedWorkspaces: string[];
  /** Knowledgebase write scope the owner chose for the assistant (v158). */
  assistantWriteScope: AccountConnectionAssistantWriteScope;
  toolPolicyVersion: number;
  lastErrorCode: string | null;
  connectedAt: string | null;
  updatedAt: string;
  revision: number;
}

export const ACCOUNT_CONNECTION_UNAVAILABLE_REASONS = [
  'not_offered_on_edition',
  'not_configured',
  'encryption_not_configured'
] as const;
export type AccountConnectionUnavailableReason =
  (typeof ACCOUNT_CONNECTION_UNAVAILABLE_REASONS)[number];

/** One provider this server offers through `/api/connections` (`?scope=all` only). */
export interface AccountConnectionProviderStatusDto {
  provider: AccountConnectionProvider;
  scope: AccountConnectionScope;
  credentialKind: AccountConnectionCredentialKind;
  available: boolean;
  reason: AccountConnectionUnavailableReason | null;
}

/**
 * `GET /api/connections`: the caller's connections in the active organization.
 * `GET /api/connections?scope=all` (v153) adds profile-scoped connections and `providers`.
 */
export interface AccountConnectionListResponse {
  items: AccountConnectionDto[];
  providers?: AccountConnectionProviderStatusDto[];
}

/** `POST /api/connections/api-keys` (v153): validated upstream, then sealed. Never echoed. */
export interface SetAccountConnectionApiKeyBody {
  provider: AccountConnectionProvider;
  apiKey: string;
}

/**
 * `PATCH /api/connections/:id` (v158): change a live Knowledgebase connection's
 * settings. `expectedRevision` must match the connection's `revision`
 * (`stale_revision` otherwise); any other provider is `invalid_request`.
 */
export interface UpdateAccountConnectionBody {
  expectedRevision: number;
  assistantWriteScope: AccountConnectionAssistantWriteScope;
}

export interface StartAccountConnectionBody {
  provider: AccountConnectionProvider;
  /** Where the backend sends the browser after the callback; validated against an allowlist. */
  returnTo: 'mobile' | 'web';
  /**
   * Profile-scoped OAuth providers (`github`, v153), `returnTo: 'web'` only: a relative
   * path on the web origin to return to (starts with `/`, not `//`; at most 512
   * characters). Defaults to `/settings/connections`.
   */
  returnPath?: string;
}

/** The client opens `authorizeUrl` (ASWebAuthenticationSession on iOS, a tab on web). */
export interface StartAccountConnectionResponse {
  connectionId: string;
  authorizeUrl: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Repository reads (local-target interface seam; executed by the runner)
// ---------------------------------------------------------------------------

/**
 * Agent-facing repository reads. Inputs name a registered binding; a model-supplied
 * absolute path is never accepted. The target enforces containment (including
 * symlinks), excludes credential and configured sensitive paths, disables external
 * diff/textconv and hooks, and never fetches, checks out, builds, or takes write intent.
 */
export const REPOSITORY_READ_OPERATIONS = [
  'observe',
  'tree',
  'branches',
  'worktrees',
  'git_status',
  'diff',
  'read_file',
  'search_text'
] as const;
export type RepositoryReadOperation = (typeof REPOSITORY_READ_OPERATIONS)[number];

export const REPOSITORY_READ_DEFAULT_BOUNDS = {
  readFileBytes: 64 * 1024,
  diffBytes: 128 * 1024,
  searchBytes: 128 * 1024,
  searchHits: 100,
  timeoutMs: 30 * 1000,
  /** Per-Git-call budget on the target, below the queue deadline. */
  targetCommandTimeoutMs: 20 * 1000,
  /** Files larger than this answer `oversized` with metadata only. */
  readFileCeilingBytes: 8 * 1024 * 1024,
  treeEntries: 500,
  treeEntriesMax: 2000,
  statusEntriesPerClass: 1000,
  searchLineChars: 400,
  searchQueryChars: 256,
  diffPaths: 50,
  concurrentReadsPerScope: 4
} as const;

/** `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`; reused on retry, never regenerated. */
export const REPOSITORY_READ_OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/** `unstaged`: worktree vs index; `staged`: index vs HEAD; `all`: worktree vs HEAD. */
export type RepositoryDiffScope = 'unstaged' | 'staged' | 'all';

export interface RepositoryReadBinding {
  executionTargetId: string;
  projectId: string;
  resourceKey: string;
}

export type RepositoryReadRequest = RepositoryReadBinding & {
  /** Idempotency key carried to the runner queue; reused on retry, never regenerated. */
  operationId: string;
} & (
    | { operation: 'observe' | 'branches' | 'worktrees' | 'git_status' }
    | { operation: 'tree'; relativePath?: string; maxEntries?: number }
    | { operation: 'diff'; scope: RepositoryDiffScope; relativePaths?: string[] }
    | { operation: 'read_file'; relativePath: string; startLine?: number; endLine?: number }
    | { operation: 'search_text'; query: string; relativePath?: string; caseSensitive?: boolean }
  );

export type RepositoryReadOutcome =
  | 'ok'
  | 'unavailable'
  | 'target_offline'
  | 'timeout'
  | 'denied'
  | 'binary'
  | 'oversized'
  | 'not_found';

export interface RepositoryReadResult {
  operationId: string;
  operation: RepositoryReadOperation;
  binding: RepositoryReadBinding;
  outcome: RepositoryReadOutcome;
  head: string | null;
  branch: string | null;
  observedAt: string;
  bytes: number;
  truncated: boolean;
  /**
   * Operation-specific bounded payload; text content is UTF-8. `git_status`:
   * {@link RepositoryGitStatusData}; `diff`: {@link RepositoryDiffData}; `read_file`:
   * {@link RepositoryFileData}; `search_text`: {@link RepositorySearchData}; the
   * existing reads carry their capability payloads. Non-`ok` outcomes carry
   * `{ message }` plus any size metadata.
   */
  data: unknown;
}

export interface RepositoryGitStatusEntry {
  path: string;
  /** Rename/copy source, else null. */
  originalPath: string | null;
  /** Porcelain v2 `XY` index and worktree columns (`.` = unchanged). */
  index: string;
  worktree: string;
}

export interface RepositoryGitStatusData {
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  staged: RepositoryGitStatusEntry[];
  unstaged: RepositoryGitStatusEntry[];
  untracked: string[];
  conflicted: RepositoryGitStatusEntry[];
}

export interface RepositoryDiffData {
  scope: RepositoryDiffScope;
  /** Unified diff of tracked files, sensitive sections withheld. */
  diff: string;
  /** Paths whose sections appear in `diff`. */
  files: string[];
  /** Sensitive paths whose content was withheld. */
  excludedPaths: string[];
}

export interface RepositoryFileData {
  relativePath: string;
  totalBytes: number;
  /** Null for `binary`/`oversized`. */
  totalLines: number | null;
  startLine: number | null;
  endLine: number | null;
  /** Null for `binary`/`oversized`. */
  content: string | null;
}

export interface RepositorySearchHit {
  path: string;
  line: number;
  text: string;
}

export interface RepositorySearchData {
  query: string;
  caseSensitive: boolean;
  hits: RepositorySearchHit[];
}
