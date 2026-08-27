// Runner-queue provider transport: serves capabilities on a local target the
// backend is *not* co-located with, by queueing the call and awaiting the
// runner's answer.
//
// Every method is the same three steps — queue an `execution_requests` row
// carrying `{ kind, capability, input }`, wait for the runner to store the
// `CapabilityResult`, return that envelope stamped `transport: 'runner_queue'`.
// Nothing here knows what any individual capability means; the queue is the
// transport and `local-target-mutation-runner.ts` is the far end. Callers get
// an ordinary `LocalTargetCapabilities` instance and never branch on whether
// the target happens to be this machine.

import type { ServiceContext } from '../context.ts';
import { ServiceError } from '../errors.ts';
import {
  createLocalTargetMutationRequest,
  LOCAL_TARGET_MUTATION_READ_TIMEOUT_MS,
  LOCAL_TARGET_MUTATION_WRITE_TIMEOUT_MS,
  type LocalTargetMutationCompletionListenerFactory,
  type LocalTargetMutationKind,
  waitForLocalTargetMutationResult
} from '../local-target-mutations.ts';

import { fail } from './result.ts';
import type {
  BranchListResult,
  CapabilityResult,
  CurrentDiffResult,
  DiscoverLatchInput,
  DiscoverLatchResult,
  DoctorResult,
  GenerateCommitMessageInput,
  GenerateCommitMessageResult,
  InspectLatchSessionInput,
  InspectLatchSessionResult,
  LaunchAgentInput,
  LaunchAgentResult,
  ListBranchesInput,
  ListWorktreesInput,
  ListWorktreesResult,
  LocalTargetCapabilities,
  ObserveResourceInput,
  OpenLatchSessionInput,
  OpenLatchSessionResult,
  PerformBranchActionInput,
  PerformBranchActionResult,
  PrepareBranchInput,
  PrepareBranchResult,
  PurgeMergedWorktreesInput,
  PurgeWorktreesResult,
  QueueableCapabilityName,
  ReadCurrentDiffInput,
  ReadRepositoryTreeInput,
  RemoveWorktreeInput,
  RepositoryTreeResult,
  ResourceObservation,
  SendLatchMessageInput,
  SendLatchMessageResult,
  StopLatchSessionInput,
  StopLatchSessionResult,
  TargetMetadata,
  WriteProjectMetadataInput,
  WriteProjectMetadataResult
} from './types.ts';

/** Everything the provider needs to write a job the runner can claim. */
export interface RunnerQueueContext {
  ctx: ServiceContext;
  /** The project whose queue and authorization this call runs under. */
  projectId: string;
  /**
   * The mission to anchor the job to, when the call has one. `null` queues a
   * mission-less capability call (a Latch probe, a repository read, `doctor`),
   * authorized by project + execution target instead.
   */
  missionId?: string | null;
  /** Deadline for read capabilities; defaults to 30s. */
  readTimeoutMs?: number;
  /** Deadline for mutating capabilities; defaults to 120s. */
  writeTimeoutMs?: number;
  /** Fallback poll cadence when no completion listener can be armed. */
  pollIntervalMs?: number;
  /**
   * Postgres completion listener factory. Absent (or returning null) the waiter
   * falls back to a bounded poll, which is what SQLite always does.
   */
  createCompletionListener?: LocalTargetMutationCompletionListenerFactory | null;
}

/** Capabilities that only observe; they get the shorter deadline. */
const READ_CAPABILITIES = new Set<QueueableCapabilityName>([
  'observeResource',
  'readRepositoryTree',
  'listBranches',
  'listWorktrees',
  'readCurrentDiff',
  'generateCommitMessageFromLocalDiff',
  'discoverLatch',
  'inspectLatchSession',
  'doctor'
]);

/**
 * The activity-feed-bearing kinds keep their names so completion still records
 * the branch/worktree events the mission timeline expects; everything else is a
 * plain capability call.
 */
function mutationKindFor(capability: QueueableCapabilityName): LocalTargetMutationKind {
  if (capability === 'performBranchAction') return 'branch_action';
  if (capability === 'purgeMergedWorktrees' || capability === 'removeWorktree') {
    return 'worktree_purge';
  }
  return 'capability_call';
}

export class RunnerQueueProvider implements LocalTargetCapabilities {
  readonly target: TargetMetadata;

  constructor(
    target: TargetMetadata,
    private readonly queue: RunnerQueueContext
  ) {
    this.target = { ...target, transport: 'runner_queue' };
  }

  /**
   * Queue one capability call on this target and wait for its result.
   *
   * `operationId` doubles as the queue's idempotency key: two calls with the
   * same id resolve to one job, so a retry after a `LOCAL_TARGET_TIMEOUT` waits
   * on the original rather than doing the work twice.
   */
  async #call<T>(
    capability: QueueableCapabilityName,
    input: Record<string, unknown>,
    options: { operationId?: string | null; timeoutMs?: number } = {}
  ): Promise<CapabilityResult<T>> {
    const executionTargetId = this.target.executionTargetId;
    if (!executionTargetId) {
      return fail(
        this.target,
        'LOCAL_TARGET_REQUIRED',
        'This operation must run on a declared execution target, and none is selected.'
      );
    }
    const timeoutMs =
      options.timeoutMs ??
      (READ_CAPABILITIES.has(capability)
        ? (this.queue.readTimeoutMs ?? LOCAL_TARGET_MUTATION_READ_TIMEOUT_MS)
        : (this.queue.writeTimeoutMs ?? LOCAL_TARGET_MUTATION_WRITE_TIMEOUT_MS));
    let requestId: string;
    try {
      const queued = await createLocalTargetMutationRequest({
        ctx: this.queue.ctx,
        projectId: this.queue.projectId,
        missionId: this.queue.missionId ?? null,
        executionTargetId,
        kind: mutationKindFor(capability),
        capability,
        input,
        operationId: options.operationId ?? null
      });
      requestId = queued.id;
    } catch (error) {
      // Queueing is the only step that can throw here; turn it into the typed
      // failure every capability caller already handles.
      return fail(
        this.target,
        'TARGET_OPERATION_FAILED',
        error instanceof ServiceError || error instanceof Error
          ? error.message
          : 'Could not queue the operation for this execution target.'
      );
    }
    return (await waitForLocalTargetMutationResult({
      ctx: this.queue.ctx,
      requestId,
      target: this.target,
      timeoutMs,
      ...(this.queue.pollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: this.queue.pollIntervalMs }),
      createListener: this.queue.createCompletionListener ?? null
    })) as CapabilityResult<T>;
  }

  writeProjectMetadata(
    input: WriteProjectMetadataInput
  ): Promise<CapabilityResult<WriteProjectMetadataResult>> {
    return this.#call('writeProjectMetadata', { ...input });
  }

  observeResource(input: ObserveResourceInput): Promise<CapabilityResult<ResourceObservation>> {
    return this.#call('observeResource', { ...input });
  }

  readRepositoryTree(
    input: ReadRepositoryTreeInput
  ): Promise<CapabilityResult<RepositoryTreeResult>> {
    return this.#call('readRepositoryTree', { ...input });
  }

  listBranches(input: ListBranchesInput): Promise<CapabilityResult<BranchListResult>> {
    return this.#call('listBranches', { ...input });
  }

  prepareBranch(input: PrepareBranchInput): Promise<CapabilityResult<PrepareBranchResult>> {
    return this.#call('prepareBranch', { ...input });
  }

  listWorktrees(input: ListWorktreesInput): Promise<CapabilityResult<ListWorktreesResult>> {
    return this.#call('listWorktrees', { ...input });
  }

  removeWorktree(input: RemoveWorktreeInput): Promise<CapabilityResult<PurgeWorktreesResult>> {
    return this.#call('removeWorktree', { ...input });
  }

  purgeMergedWorktrees(
    input: PurgeMergedWorktreesInput
  ): Promise<CapabilityResult<PurgeWorktreesResult>> {
    return this.#call('purgeMergedWorktrees', { ...input });
  }

  performBranchAction(
    input: PerformBranchActionInput
  ): Promise<CapabilityResult<PerformBranchActionResult>> {
    return this.#call('performBranchAction', { ...input });
  }

  readCurrentDiff(input: ReadCurrentDiffInput): Promise<CapabilityResult<CurrentDiffResult>> {
    return this.#call('readCurrentDiff', { ...input });
  }

  generateCommitMessageFromLocalDiff(
    input: GenerateCommitMessageInput
  ): Promise<CapabilityResult<GenerateCommitMessageResult>> {
    return this.#call('generateCommitMessageFromLocalDiff', { ...input });
  }

  /**
   * Launching an agent has its own claim path on the same queue — the runner
   * spawns it directly from the claimed request. Routing it through the generic
   * dispatcher too would let a launch and a queued job race for one request, so
   * this transport declines it outright.
   */
  launchAgent(_input: LaunchAgentInput): Promise<CapabilityResult<LaunchAgentResult>> {
    return Promise.resolve(
      fail(
        this.target,
        'LOCAL_TARGET_UNSUPPORTED',
        'Agent launch is queued as an execution request, not as a local-target capability call.'
      )
    );
  }

  discoverLatch(input: DiscoverLatchInput): Promise<CapabilityResult<DiscoverLatchResult>> {
    return this.#call('discoverLatch', { ...input });
  }

  inspectLatchSession(
    input: InspectLatchSessionInput
  ): Promise<CapabilityResult<InspectLatchSessionResult>> {
    return this.#call('inspectLatchSession', { ...input });
  }

  openLatchSession(
    input: OpenLatchSessionInput
  ): Promise<CapabilityResult<OpenLatchSessionResult>> {
    return this.#call('openLatchSession', { ...input });
  }

  stopLatchSession(
    input: StopLatchSessionInput
  ): Promise<CapabilityResult<StopLatchSessionResult>> {
    return this.#call('stopLatchSession', { ...input });
  }

  /**
   * Answer delivery. The caller's `operationId` is the idempotency key on both
   * ends — the queue's, so a retry never queues a second job, and Latch's, so a
   * redelivered message is never applied twice. `waitForIdleMs` extends the
   * deadline because the runner may legitimately wait for the agent to go idle
   * before it can send.
   */
  sendLatchMessage(
    input: SendLatchMessageInput
  ): Promise<CapabilityResult<SendLatchMessageResult>> {
    const waitForIdleMs = typeof input.waitForIdleMs === 'number' ? input.waitForIdleMs : 0;
    return this.#call(
      'sendLatchMessage',
      { ...input },
      {
        operationId: input.operationId,
        timeoutMs:
          (this.queue.writeTimeoutMs ?? LOCAL_TARGET_MUTATION_WRITE_TIMEOUT_MS) +
          Math.max(0, waitForIdleMs)
      }
    );
  }

  doctor(): Promise<CapabilityResult<DoctorResult>> {
    return this.#call('doctor', {});
  }
}
