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
 * raw tool results stay out of ordinary DTOs, realtime and global logs. The
 * owner-only diagnostic DTO below deliberately carries unredacted observations.
 * Credential envelopes and OAuth material are not separately exported.
 */

// ---------------------------------------------------------------------------
// Controlled vocabularies (closed; adding a value requires a contract bump)
// ---------------------------------------------------------------------------
import type {
  AccountConnectionAssistantWriteScope,
  AccountConnectionCredentialKind,
  AccountConnectionProvider,
  AccountConnectionScope,
  AccountConnectionState,
  AccountConnectionUnavailableReason,
  RepositoryReadOperation
} from './generated/api.js';
import { vocabulary } from './vocabulary.js';

// REST DTOs generated from contract/api/openapi.yaml (ADR 0006).
export type {
  AccountConnectionAssistantWriteScope,
  AccountConnectionCredentialKind,
  AccountConnectionDto,
  AccountConnectionListResponse,
  AccountConnectionProvider,
  AccountConnectionProviderStatusDto,
  AccountConnectionScope,
  AccountConnectionState,
  AccountConnectionUnavailableReason,
  AckChatEventsBody,
  AnswerChatQuestionBody,
  CancelChatRunBody,
  ChatAckDto,
  ChatAssignmentDto,
  ChatBlockDto,
  ChatCreatedMissionDto,
  ChatCreationReceiptDto,
  ChatDiagnosticDto,
  ChatDiagnosticPageDto,
  ChatEventDto,
  ChatEventPageDto,
  ChatEvidenceBlockDto,
  ChatEvidenceDto,
  ChatKnowledgebaseWriteDto,
  ChatMessageDto,
  ChatNotificationDto,
  ChatNotificationListResponse,
  ChatPresenceDto,
  ChatProposalBlockDto,
  ChatProposalDto,
  ChatProposalMissionDto,
  ChatProposalObjectiveDto,
  ChatProposalRevisionDto,
  ChatProviderReadinessDto,
  ChatProvidersResponse,
  ChatQuestionDto,
  ChatQuestionOptionDto,
  ChatRunDto,
  ChatRunUsageDto,
  ChatSourceLocatorDto,
  ChatStreamFrameDto,
  ChatTextBlockDto,
  ChatThreadDto,
  ChatThreadListResponse,
  ChatThreadSnapshotDto,
  ChatUnavailableBlockDto,
  ContinueChatRunBody,
  ContinueChatRunResponse,
  CreateChatThreadBody,
  CreateChatThreadResponse,
  CreateFromChatProposalBody,
  CreateFromChatProposalResponse,
  MarkChatNotificationReadBody,
  RepositoryReadOperation,
  RepositoryReadRequest,
  RepositoryReadResult,
  SetAccountConnectionApiKeyBody,
  StartAccountConnectionBody,
  StartAccountConnectionResponse,
  SubmitChatMessageBody,
  SubmitChatMessageResponse,
  UpdateAccountConnectionBody,
  UpdateChatPresenceBody,
  UpdateChatThreadBody
} from './generated/api.js';

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
 *
 * The blocks the server writes are `ChatBlockDto` (generated). The `question` and
 * `mission` kinds below are not written by any current writer (see
 * contract/api/schema-disagreements.md Y1); they stay for clients that render them.
 */
interface ChatBlockBase {
  id: string;
  fallbackText: string;
}

export interface ChatQuestionBlockDto extends ChatBlockBase {
  kind: 'question';
  questionId: string;
}

/** A live reference to a mission or objective; permissions are rechecked on every read. */
export interface ChatMissionBlockDto extends ChatBlockBase {
  kind: 'mission';
  missionId: string;
  objectiveId: string | null;
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

/** Deep link carried by a conversation push; opens the thread, including on cold start. */
export const CHAT_NOTIFICATION_DEEP_LINK = 'overlord://chat/threads/:threadId' as const;

// ---------------------------------------------------------------------------
// Account connections
// ---------------------------------------------------------------------------

export const ACCOUNT_CONNECTION_PROVIDERS = vocabulary<AccountConnectionProvider>()([
  'knowledgebase',
  'everhour',
  'github'
]);
/**
 * `organization`: owned by a profile inside one organization (Knowledgebase).
 * `profile`: owned by the profile across every organization (Everhour, GitHub).
 */
export const ACCOUNT_CONNECTION_SCOPES = vocabulary<AccountConnectionScope>()([
  'organization',
  'profile'
]);
export const ACCOUNT_CONNECTION_CREDENTIAL_KINDS = vocabulary<AccountConnectionCredentialKind>()([
  'oauth',
  'api_key'
]);
/** Server-side envelope formats (never projected); listed for the closed vocabulary. */
export const ACCOUNT_CONNECTION_CREDENTIAL_FORMATS = [
  'connection-v1',
  'everhour-user-key-v1',
  'github-user-oauth-v1'
] as const;
export type AccountConnectionCredentialFormat =
  (typeof ACCOUNT_CONNECTION_CREDENTIAL_FORMATS)[number];

export const ACCOUNT_CONNECTION_STATES = vocabulary<AccountConnectionState>()([
  'pending',
  'connected',
  'reauthorization_required',
  'disconnected'
]);
/**
 * How far the assistant may write through a Knowledgebase connection (v158).
 * `per_request` (default): only the one workspace a user allows on a single message
 * (`knowledgebaseWrite`, v154). `all_workspaces`: reads and writes in every workspace
 * in `authorizedWorkspaces`, for every run, without a per-message grant. Always
 * `per_request` for other providers.
 */
export const ACCOUNT_CONNECTION_ASSISTANT_WRITE_SCOPES =
  vocabulary<AccountConnectionAssistantWriteScope>()(['per_request', 'all_workspaces']);
export const ACCOUNT_CONNECTION_UNAVAILABLE_REASONS =
  vocabulary<AccountConnectionUnavailableReason>()([
    'not_offered_on_edition',
    'not_configured',
    'encryption_not_configured'
  ]);

// ---------------------------------------------------------------------------
// Repository reads (local-target interface seam; executed by the runner)
// ---------------------------------------------------------------------------

/**
 * Agent-facing repository reads. Inputs name a registered binding; a model-supplied
 * absolute path is never accepted. The target enforces containment (including
 * symlinks), excludes credential and configured sensitive paths, disables external
 * diff/textconv and hooks, and never fetches, checks out, builds, or takes write intent.
 */
export const REPOSITORY_READ_OPERATIONS = vocabulary<RepositoryReadOperation>()([
  'observe',
  'tree',
  'branches',
  'worktrees',
  'git_status',
  'diff',
  'read_file',
  'search_text'
]);
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

export type RepositoryReadOutcome =
  | 'ok'
  | 'unavailable'
  | 'target_offline'
  | 'timeout'
  | 'denied'
  | 'binary'
  | 'oversized'
  | 'not_found';

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
