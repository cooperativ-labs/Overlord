// The local-target capability contract (R2 of
// planning/feature-plans/local-execution-target-capabilities.md §4).
//
// All checkout-local work — Git, worktrees, file/metadata writes, resource
// observations, agent launch — flows through this single interface. Callers
// depend on the interface, never on ad-hoc `existsSync`/`git` calls. Several
// interchangeable *provider transports* implement it (in-process, desktop
// bridge, runner queue, and a fake for tests); the resolver in `registry.ts`
// picks the transport from the selected target.
//
// This module is intentionally dependency-free and lives in `@overlord/core` so
// the REST API, Runner/CLI, and Desktop layers can all share one contract.
// Payload types are defined natively here (not as REST DTOs from
// `webapp/shared/contract.ts`) to keep the boundary clean; the backend
// in-process provider adapts between these payloads and its DTOs.

/**
 * Stable, typed error codes a capability may return. These cross the REST
 * boundary (so the UI can branch on them) and must never leak raw
 * filesystem/Git error text. Extend deliberately and keep messages short.
 */
export type LocalTargetErrorCode =
  /** No selected/eligible target can serve this capability (the generalized
   *  successor to the host-side `LOCAL_FILESYSTEM_UNAVAILABLE` guard). */
  | 'LOCAL_TARGET_REQUIRED'
  /** A target is selected but not reachable right now (offline runner, etc.). */
  | 'LOCAL_TARGET_UNREACHABLE'
  /** The linked directory does not exist on the target. */
  | 'RESOURCE_MISSING'
  /** The path exists but is not a Git repository. */
  | 'NOT_GIT_REPOSITORY'
  /** The target cannot access the path (filesystem permissions). */
  | 'PERMISSION_DENIED'
  /** A git/worktree command failed on the target. */
  | 'GIT_COMMAND_FAILED'
  /** The resolved provider transport does not implement this capability yet. */
  | 'CAPABILITY_NOT_IMPLEMENTED'
  /**
   * The queued capability call was accepted but no result arrived before the
   * caller's deadline. The job is still live on the target — callers show
   * "still running", they never re-queue the same operation.
   */
  | 'LOCAL_TARGET_TIMEOUT'
  /**
   * The named capability is not one the runner will execute off-device
   * (an unknown name, or `launchAgent`, which owns its own launch path). The
   * generic dispatcher fails closed with this rather than guessing.
   */
  | 'LOCAL_TARGET_UNSUPPORTED'
  /** Generic capability failure with no more specific code. */
  | 'TARGET_OPERATION_FAILED'
  /**
   * Latch has no metadata for this session id (pruned or removed). The device
   * is reachable and the CLI ran; the session is gone. Distinct from
   * reachability / `TARGET_OPERATION_FAILED`.
   */
  | 'LATCH_SESSION_ABSENT'
  | 'UNKNOWN';

/**
 * The error codes at runtime, for rehydrating a stored failure envelope that
 * crossed a process boundary as plain JSON. Anything unrecognized becomes
 * `UNKNOWN` rather than being trusted verbatim.
 */
export const LOCAL_TARGET_ERROR_CODES = [
  'LOCAL_TARGET_REQUIRED',
  'LOCAL_TARGET_UNREACHABLE',
  'RESOURCE_MISSING',
  'NOT_GIT_REPOSITORY',
  'PERMISSION_DENIED',
  'GIT_COMMAND_FAILED',
  'CAPABILITY_NOT_IMPLEMENTED',
  'LOCAL_TARGET_TIMEOUT',
  'LOCAL_TARGET_UNSUPPORTED',
  'TARGET_OPERATION_FAILED',
  'LATCH_SESSION_ABSENT',
  'UNKNOWN'
] as const satisfies readonly LocalTargetErrorCode[];

/** Narrow an untrusted string to a {@link LocalTargetErrorCode}, else `UNKNOWN`. */
export function toLocalTargetErrorCode(value: unknown): LocalTargetErrorCode {
  return typeof value === 'string' &&
    (LOCAL_TARGET_ERROR_CODES as readonly string[]).includes(value)
    ? (value as LocalTargetErrorCode)
    : 'UNKNOWN';
}

/**
 * Per-target resource availability (§5 "Target Observation"). This is
 * target-scoped and time-sensitive — distinct from the backend-owned resource
 * *lifecycle* (`active`/`archived`). The backend must not infer it from its own
 * filesystem unless it is itself acting as a local target through this interface.
 */
export type TargetObservationState =
  | 'available'
  | 'missing'
  | 'unreachable'
  | 'permission_denied'
  | 'not_git_repository'
  | 'unknown';

/** Which transport actually served a capability call. */
export type CapabilityTransport = 'in_process' | 'desktop_bridge' | 'runner_queue' | 'fake';

/**
 * Enough metadata to explain *where* an operation ran. Carried on every result
 * (success or failure) so the UI can show the originating target/device.
 */
export interface TargetMetadata {
  /** The `execution_targets.id` this provider acts for, or null when unresolved. */
  executionTargetId: string | null;
  /** Human-readable device/target label for the UI. */
  deviceLabel: string | null;
  /** The transport that produced the result. */
  transport: CapabilityTransport;
}

export interface CapabilitySuccess<T> {
  ok: true;
  value: T;
  target: TargetMetadata;
}

export interface CapabilityFailure {
  ok: false;
  code: LocalTargetErrorCode;
  message: string;
  details?: unknown;
  target: TargetMetadata;
}

/** Discriminated result for every capability — never throw raw errors across it. */
export type CapabilityResult<T> = CapabilitySuccess<T> | CapabilityFailure;

// ---- Per-capability payloads (§4 table) ---------------------------------

export interface WriteProjectMetadataInput {
  directoryPath: string;
  projectId: string;
  projectName?: string | null;
  resourceId: string;
  resourceKey?: string | null;
  executionTargetId?: string | null;
  isPrimary: boolean;
}
export interface WriteProjectMetadataResult {
  /** Absolute path of the written `.overlord/project.json`. */
  path: string;
  written: boolean;
}

export interface ObserveResourceInput {
  resourceId: string;
  /** The recorded checkout path to observe on this target. */
  path: string;
}
export interface ResourceObservation {
  state: TargetObservationState;
  gitRoot?: string | null;
  branch?: string | null;
  commit?: string | null;
  /** ISO-8601 timestamp of when the target made the observation. */
  observedAt: string;
}

export interface ReadRepositoryTreeInput {
  resourceId: string;
  /** Absolute checkout path resolved by the backend before crossing this boundary. */
  repoPath: string;
  /** Repo-relative subdirectory to list; null/empty lists the root. */
  subPath?: string | null;
}
export interface RepositoryTreeEntry {
  name: string;
  /** Repo-relative path. */
  path: string;
  type: 'file' | 'directory';
  parentPath: string | null;
  depth: number;
}
export interface RepositoryTreeResult {
  rootPath: string;
  gitRoot: string;
  branch: string | null;
  commit: string | null;
  entries: RepositoryTreeEntry[];
  truncated: boolean;
}

export interface ListBranchesInput {
  resourceId: string;
  /** Absolute checkout path resolved by the backend before crossing this boundary. */
  repoPath: string;
}
export interface BranchListResult {
  local: string[];
  remote: string[];
  current: string | null;
}

export interface PrepareBranchInput {
  missionId: string;
  /** Force a specific branch name (the `--branch` escape hatch). */
  branch?: string | null;
  /** Prepare a dedicated worktree (vs. a branch-only checkout). */
  useWorktree?: boolean;
}
export interface PrepareBranchResult {
  branch: string;
  baseBranch: string;
  /** Worktree path when a worktree was prepared, else null (branch-only). */
  worktreePath: string | null;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  dirty: boolean;
  merged: boolean;
}

/** Raw worktree row returned by the local target before REST enrichment. */
export interface ManagedWorktreeEntry {
  path: string;
  branch: string | null;
  primaryRepoPath: string;
  dirty: boolean;
}

export interface ListWorktreesInput {
  worktreeRoot: string;
  projects: Array<{ primaryRepoPath: string }>;
}

export interface ListWorktreesResult {
  worktrees: ManagedWorktreeEntry[];
}

export interface RemoveWorktreeInput {
  path: string;
  primaryRepoPath: string;
  /** Remove even when the worktree is dirty (dirty-protection override). */
  force?: boolean;
}

/**
 * Either the caller already knows which worktrees to purge, or it asks the
 * target to work that out. A control-plane backend has no filesystem, so it can
 * only ever send the `discover` form; the desktop bridge, which does, resolves
 * the entries itself and sends them explicitly.
 */
export type PurgeMergedWorktreesInput =
  | { entries: Array<{ path: string; primaryRepoPath: string }>; discover?: false }
  | {
      discover: true;
      /** Repository whose worktrees are enumerated. */
      primaryRepoPath: string;
      /**
       * Only worktrees under this root are managed by Overlord. Omit it and the
       * target resolves its own root — the honest default, since the root comes
       * from that machine's environment and home directory.
       */
      worktreeRoot?: string;
    };

export interface PurgeWorktreesResult {
  removed: string[];
  skipped: Array<{ path: string; reason: string }>;
}

export type BranchActionKind = 'integrate' | 'commit' | 'push_parent' | 'publish';

export interface PerformBranchActionInput {
  action: BranchActionKind;
  branchName: string;
  baseBranch: string;
  worktreePath: string;
  primaryRepoPath: string;
  message?: string;
}

export interface PerformBranchActionResult {
  summary: string;
}

export interface ReadCurrentDiffInput {
  missionId: string;
  filePath?: string | null;
}
export interface CurrentDiffResult {
  workingDirectory: string | null;
  diff: string;
}

export interface GenerateCommitMessageInput {
  /** Absolute worktree path resolved by the backend before crossing this boundary. */
  worktreePath: string;
}
export interface GenerateCommitMessageResult {
  /** Local diff text for the backend summarizer (Automations Layer). */
  diff: string;
}

export interface LaunchAgentInput {
  executionRequestId: string;
}
export interface LaunchAgentResult {
  launched: boolean;
  sessionId?: string | null;
}

/**
 * Probe Latch on the execution target (coo:702). Read-only: it runs
 * `latch capabilities --json` and never installs or upgrades anything. It must
 * run on the device where the agent process will run, which is exactly what
 * this capability boundary guarantees — a browser or hosted backend cannot
 * answer it for a machine it is not.
 */
export interface DiscoverLatchInput {
  /** Executable to probe; defaults to the provider's `latch`. */
  executable?: string | null;
  /**
   * Execution target this probe is for, so a settings probe and a runner probe
   * on the same device share one cache entry. Providers that already know their
   * target ignore a mismatching value in favour of their own.
   */
  executionTargetId?: string | null;
  /** Skip the per-target cache and re-probe. */
  force?: boolean;
}

/** Capability flags reported by `latch capabilities --json`. */
export interface LatchCapabilityFlagsPayload {
  create: boolean;
  openViewer: boolean;
  localAttach: boolean;
  cloudAttach: boolean;
  selfUpdate: boolean;
  extensions: string[];
}

/**
 * Three distinguishable discovery states. `directSelectable` is always true —
 * direct execution remains offerable no matter what Latch reports.
 */
export type DiscoverLatchResult =
  | {
      state: 'found';
      executable: string;
      resolvedPath: string;
      protocolVersion: number;
      productVersion: string;
      capabilities: LatchCapabilityFlagsPayload;
      checkedAt: string;
      latchSelectable: boolean;
      directSelectable: true;
    }
  | {
      state: 'not_installed';
      executable: string;
      /** Standalone install command to present; Overlord never runs it. */
      installCommand: string;
      checkedAt: string;
      latchSelectable: boolean;
      directSelectable: true;
    }
  | {
      state: 'incompatible';
      executable: string;
      resolvedPath: string | null;
      protocolVersion: number | null;
      productVersion: string | null;
      /** Stable id of what is missing, e.g. `create` or `protocolVersion`. */
      missingCapability: string;
      detail: string;
      checkedAt: string;
      latchSelectable: boolean;
      directSelectable: true;
    };

export interface LatchSessionInput {
  providerSessionId: string;
  executable?: string | null;
}

export type InspectLatchSessionInput = LatchSessionInput;

export interface InspectLatchSessionResult {
  providerSessionId: string;
  name: string;
  state: 'running' | 'exited' | 'stopping' | 'lost';
  exitCode: number | null;
  inspectedAt: string;
}

export interface OpenLatchSessionInput extends LatchSessionInput {
  viewerKind: string;
  /**
   * Overlord's window-or-tab preference for this session. Optional so a caller
   * that has not resolved one keeps today's behavior (a new window); when
   * present it is sent to Latch explicitly rather than deferring to Latch's own
   * stored default.
   */
  openAs?: 'window' | 'tab' | null;
}

export interface OpenLatchSessionResult {
  providerSessionId: string;
  viewer: string;
  opened: boolean;
  /** Shape Latch reports it used; null when the CLI predates `latch open --as`. */
  behavior?: 'window' | 'tab' | null;
}

export type StopLatchSessionInput = LatchSessionInput;

export interface StopLatchSessionResult {
  providerSessionId: string;
  state: 'running' | 'exited' | 'stopping' | 'lost';
}

/**
 * Deliver one user turn into a running Latch session (coo:833). The body speaks
 * Latch v2's Conversation Hub on loopback; it is the only sanctioned way an
 * answer to a blocking question reaches a running agent, and it never
 * synthesizes keystrokes or resumes a headless copy of the session.
 */
export interface SendLatchMessageInput extends LatchSessionInput {
  /**
   * Caller-supplied idempotency key for this delivery. It is the Latch
   * `operationId` *and* the queue's idempotency key, so a retried call can
   * never deliver the same answer twice.
   */
  operationId: string;
  /** The message text delivered as a user turn. */
  text: string;
  /**
   * How long to wait for a `working`/`starting` session to become able to
   * accept a message before refusing. Defaults to 30s in the provider body.
   */
  waitForIdleMs?: number;
}

export interface SendLatchMessageResult {
  providerSessionId: string;
  operationId: string;
  /**
   * Latch's own `operation_result` status. `ambiguous` means the send may or
   * may not have landed — callers record it and never resend.
   */
  status: 'accepted' | 'refused' | 'ambiguous';
  /** Latch's `state.sendMessage.reason` when refused; null otherwise. */
  reason: string | null;
  deliveredAt: string;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface DoctorResult {
  checks: DoctorCheck[];
}

/**
 * The local-target capability interface. One per resolved target; the `target`
 * metadata describes which device/transport this instance acts for. Every
 * method returns a {@link CapabilityResult} rather than throwing.
 */
export interface LocalTargetCapabilities {
  readonly target: TargetMetadata;

  writeProjectMetadata(
    input: WriteProjectMetadataInput
  ): Promise<CapabilityResult<WriteProjectMetadataResult>>;
  observeResource(input: ObserveResourceInput): Promise<CapabilityResult<ResourceObservation>>;
  readRepositoryTree(
    input: ReadRepositoryTreeInput
  ): Promise<CapabilityResult<RepositoryTreeResult>>;
  listBranches(input: ListBranchesInput): Promise<CapabilityResult<BranchListResult>>;
  prepareBranch(input: PrepareBranchInput): Promise<CapabilityResult<PrepareBranchResult>>;
  listWorktrees(input: ListWorktreesInput): Promise<CapabilityResult<ListWorktreesResult>>;
  removeWorktree(input: RemoveWorktreeInput): Promise<CapabilityResult<PurgeWorktreesResult>>;
  purgeMergedWorktrees(
    input: PurgeMergedWorktreesInput
  ): Promise<CapabilityResult<PurgeWorktreesResult>>;
  performBranchAction(
    input: PerformBranchActionInput
  ): Promise<CapabilityResult<PerformBranchActionResult>>;
  readCurrentDiff(input: ReadCurrentDiffInput): Promise<CapabilityResult<CurrentDiffResult>>;
  generateCommitMessageFromLocalDiff(
    input: GenerateCommitMessageInput
  ): Promise<CapabilityResult<GenerateCommitMessageResult>>;
  launchAgent(input: LaunchAgentInput): Promise<CapabilityResult<LaunchAgentResult>>;
  discoverLatch(input: DiscoverLatchInput): Promise<CapabilityResult<DiscoverLatchResult>>;
  inspectLatchSession(
    input: InspectLatchSessionInput
  ): Promise<CapabilityResult<InspectLatchSessionResult>>;
  openLatchSession(input: OpenLatchSessionInput): Promise<CapabilityResult<OpenLatchSessionResult>>;
  stopLatchSession(input: StopLatchSessionInput): Promise<CapabilityResult<StopLatchSessionResult>>;
  sendLatchMessage(input: SendLatchMessageInput): Promise<CapabilityResult<SendLatchMessageResult>>;
  doctor(): Promise<CapabilityResult<DoctorResult>>;
}

/** The capability method names, useful for generic dispatch/registries. */
export type CapabilityName = keyof Omit<LocalTargetCapabilities, 'target'>;

/**
 * The capability names at runtime. Generic dispatchers (the runner executor,
 * the queue metadata parser) validate against this list and fail closed on
 * anything else, so an unknown or misspelled name can never reach a provider.
 * The `satisfies` clause makes the compiler reject a list that drifts from
 * {@link LocalTargetCapabilities}.
 */
export const LOCAL_TARGET_CAPABILITY_NAMES = [
  'writeProjectMetadata',
  'observeResource',
  'readRepositoryTree',
  'listBranches',
  'prepareBranch',
  'listWorktrees',
  'removeWorktree',
  'purgeMergedWorktrees',
  'performBranchAction',
  'readCurrentDiff',
  'generateCommitMessageFromLocalDiff',
  'launchAgent',
  'discoverLatch',
  'inspectLatchSession',
  'openLatchSession',
  'stopLatchSession',
  'sendLatchMessage',
  'doctor'
] as const satisfies readonly CapabilityName[];

/**
 * `launchAgent` keeps its dedicated launch path (`ovld runner` claims and
 * spawns it directly). Excluding it from the queued capability vocabulary is
 * what stops a queued job and a launch from racing for one execution request.
 */
export const QUEUEABLE_LOCAL_TARGET_CAPABILITY_NAMES = LOCAL_TARGET_CAPABILITY_NAMES.filter(
  (name): name is QueueableCapabilityName => name !== 'launchAgent'
);

/** Every capability that may be carried over the runner queue. */
export type QueueableCapabilityName = Exclude<CapabilityName, 'launchAgent'>;

/** Type guard: is `value` a capability the runner queue will execute? */
export function isQueueableCapabilityName(value: unknown): value is QueueableCapabilityName {
  return (
    typeof value === 'string' &&
    value !== 'launchAgent' &&
    (LOCAL_TARGET_CAPABILITY_NAMES as readonly string[]).includes(value)
  );
}
