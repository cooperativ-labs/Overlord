// Agent-facing repository reads (contract v152, coo:1108.zg8m).
//
// The one gateway every repository read crosses — the mission-less
// `POST /api/projects/:id/repository-reads` route and, later, the in-process
// chat tool gateway. It validates the request, resolves the caller's access to
// the named execution target and the registered resource binding, enforces the
// operation-id idempotency rule and the per-scope concurrency limit, queues the
// read for the target's runner, and maps the answer onto the contracted
// `RepositoryReadResult`. It never accepts an absolute path, never touches a
// filesystem itself, and never queues anything that writes.

import {
  REPOSITORY_READ_DEFAULT_BOUNDS,
  REPOSITORY_READ_OPERATION_ID_PATTERN,
  REPOSITORY_READ_OPERATIONS,
  type RepositoryDiffScope,
  type RepositoryReadBinding,
  type RepositoryReadOperation,
  type RepositoryReadOutcome,
  type RepositoryReadRequest,
  type RepositoryReadResult
} from '@overlord/contract';
import { createHash } from 'node:crypto';

import { targetMetadata } from './local-target/registry.ts';
import { normalizeRepositoryRelativePath } from './local-target/repository-paths.ts';
import {
  type RunnerQueueContext,
  RunnerQueueProvider
} from './local-target/runner-queue-provider.ts';
import type {
  CapabilityResult,
  LocalTargetCapabilities,
  LocalTargetErrorCode,
  RepositoryReadTargetValue,
  RepositoryTreeEntry
} from './local-target/types.ts';
import type { ServiceContext } from './context.ts';
import { resolveProjectId } from './context.ts';
import { ServiceError } from './errors.ts';
import { parseLocalTargetMutation } from './local-target-mutations.ts';
import {
  type EligibleExecutionTarget,
  getProjectExecutionTargetSelection
} from './project-execution-target.ts';
import { assertObjectiveResourceConnected } from './projects.ts';

// ---- request validation ---------------------------------------------------------

function invalid(message: string): never {
  throw new ServiceError(message, 'invalid_request', 400);
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') invalid(`${key} is required.`);
  return value.trim();
}

function optionalRelativePath(body: Record<string, unknown>, key: string): string | undefined {
  if (body[key] === undefined || body[key] === null) return undefined;
  const checked = normalizeRepositoryRelativePath(body[key]);
  if (!checked.ok) invalid(`${key}: ${checked.reason}`);
  return checked.relativePath;
}

function optionalPositiveInt(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    invalid(`${key} must be a positive integer.`);
  }
  return value;
}

/**
 * Parse an untrusted body into a {@link RepositoryReadRequest}. Paths are
 * normalized repository-relative paths; anything absolute or escaping is a 400
 * here, and the target re-checks containment against real paths.
 */
export function parseRepositoryReadRequest(raw: unknown): RepositoryReadRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('A JSON object is required.');
  const body = raw as Record<string, unknown>;
  const operation = body.operation;
  if (!(REPOSITORY_READ_OPERATIONS as readonly unknown[]).includes(operation)) {
    invalid(`operation must be one of ${REPOSITORY_READ_OPERATIONS.join(', ')}.`);
  }
  const operationId = requiredString(body, 'operationId');
  if (!REPOSITORY_READ_OPERATION_ID_PATTERN.test(operationId)) {
    invalid('operationId must be 8-128 characters of letters, digits, ".", "_", ":" or "-".');
  }
  const binding = {
    executionTargetId: requiredString(body, 'executionTargetId'),
    projectId: requiredString(body, 'projectId'),
    resourceKey: requiredString(body, 'resourceKey'),
    operationId
  };
  switch (operation as RepositoryReadOperation) {
    case 'observe':
    case 'branches':
    case 'worktrees':
    case 'git_status':
      return { ...binding, operation: operation as 'observe' };
    case 'tree': {
      const relativePath = optionalRelativePath(body, 'relativePath');
      const maxEntries = optionalPositiveInt(body, 'maxEntries');
      return {
        ...binding,
        operation: 'tree',
        ...(relativePath ? { relativePath } : {}),
        ...(maxEntries ? { maxEntries } : {})
      };
    }
    case 'diff': {
      const scope = body.scope;
      if (scope !== 'unstaged' && scope !== 'staged' && scope !== 'all') {
        invalid('scope must be unstaged, staged or all.');
      }
      let relativePaths: string[] | undefined;
      if (body.relativePaths !== undefined && body.relativePaths !== null) {
        if (!Array.isArray(body.relativePaths)) invalid('relativePaths must be an array.');
        if (body.relativePaths.length > REPOSITORY_READ_DEFAULT_BOUNDS.diffPaths) {
          invalid(`At most ${REPOSITORY_READ_DEFAULT_BOUNDS.diffPaths} paths are allowed.`);
        }
        relativePaths = body.relativePaths.map((entry, index) => {
          const checked = normalizeRepositoryRelativePath(entry);
          if (!checked.ok) invalid(`relativePaths[${index}]: ${checked.reason}`);
          return checked.relativePath || '.';
        });
      }
      return {
        ...binding,
        operation: 'diff',
        scope: scope as RepositoryDiffScope,
        ...(relativePaths ? { relativePaths } : {})
      };
    }
    case 'read_file': {
      const relativePath = optionalRelativePath(body, 'relativePath');
      if (!relativePath) invalid('relativePath is required.');
      const startLine = optionalPositiveInt(body, 'startLine');
      const endLine = optionalPositiveInt(body, 'endLine');
      if (startLine && endLine && endLine < startLine)
        invalid('endLine must not precede startLine.');
      return {
        ...binding,
        operation: 'read_file',
        relativePath,
        ...(startLine ? { startLine } : {}),
        ...(endLine ? { endLine } : {})
      };
    }
    case 'search_text': {
      const query = body.query;
      if (
        typeof query !== 'string' ||
        query.length === 0 ||
        query.length > REPOSITORY_READ_DEFAULT_BOUNDS.searchQueryChars ||
        /[\0\r\n]/.test(query)
      ) {
        invalid(
          `query must be 1-${REPOSITORY_READ_DEFAULT_BOUNDS.searchQueryChars} characters on one line.`
        );
      }
      const relativePath = optionalRelativePath(body, 'relativePath');
      if (body.caseSensitive !== undefined && typeof body.caseSensitive !== 'boolean') {
        invalid('caseSensitive must be a boolean.');
      }
      return {
        ...binding,
        operation: 'search_text',
        query,
        ...(relativePath ? { relativePath } : {}),
        ...(typeof body.caseSensitive === 'boolean' ? { caseSensitive: body.caseSensitive } : {})
      };
    }
  }
}

// ---- concurrency ---------------------------------------------------------------

/**
 * At most `limit` reads in flight per scope (a chat run, or a caller of the
 * route). Further reads wait for a slot; a waiter that is cancelled or runs
 * out of time leaves the queue without ever reaching the target.
 */
export class RepositoryReadLimiter {
  readonly #active = new Map<string, number>();
  readonly #waiters = new Map<string, Array<() => void>>();

  constructor(readonly limit: number = REPOSITORY_READ_DEFAULT_BOUNDS.concurrentReadsPerScope) {}

  inFlight(scope: string): number {
    return this.#active.get(scope) ?? 0;
  }

  /** Resolve a release function, or null when cancelled or out of time. */
  acquire(
    scope: string,
    timeoutMs: number,
    signal?: AbortSignal | null
  ): Promise<(() => void) | null> {
    if (signal?.aborted) return Promise.resolve(null);
    if (this.inFlight(scope) < this.limit) {
      this.#active.set(scope, this.inFlight(scope) + 1);
      return Promise.resolve(this.#releaser(scope));
    }
    return new Promise(resolve => {
      const queue = this.#waiters.get(scope) ?? [];
      this.#waiters.set(scope, queue);
      const leave = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', leave);
        const index = queue.indexOf(grant);
        if (index >= 0) queue.splice(index, 1);
        if (queue.length === 0) this.#waiters.delete(scope);
        resolve(null);
      };
      const grant = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', leave);
        resolve(this.#releaser(scope));
      };
      const timer = setTimeout(leave, Math.max(0, timeoutMs));
      signal?.addEventListener('abort', leave, { once: true });
      queue.push(grant);
    });
  }

  #releaser(scope: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const queue = this.#waiters.get(scope);
      const next = queue?.shift();
      if (queue && queue.length === 0) this.#waiters.delete(scope);
      if (next) {
        next(); // hand the slot over; the count is unchanged
        return;
      }
      const count = this.inFlight(scope) - 1;
      if (count <= 0) this.#active.delete(scope);
      else this.#active.set(scope, count);
    };
  }
}

/** Process-wide limiter shared by the route and the chat gateway. */
export const repositoryReadLimiter = new RepositoryReadLimiter();

// ---- execution -------------------------------------------------------------------

export type RepositoryReadProviderFactory = (args: {
  target: EligibleExecutionTarget;
  queue: RunnerQueueContext;
}) => LocalTargetCapabilities;

const defaultProviderFactory: RepositoryReadProviderFactory = ({ target, queue }) =>
  new RunnerQueueProvider(
    targetMetadata(
      {
        executionTargetId: target.executionTargetId,
        type: target.type,
        deviceLabel: target.deviceLabel,
        reachable: target.reachable
      },
      'runner_queue'
    ),
    queue
  );

/**
 * Queue key for one operation. Derived from the acting workspace user and the
 * caller's operation id, so a retry waits on the original job, and one user
 * can never address — or read the result of — another user's operation.
 */
export function repositoryReadIdempotencyKey(
  actorWorkspaceUserId: string,
  operationId: string
): string {
  const digest = createHash('sha256')
    .update(`${actorWorkspaceUserId}\n${operationId}`)
    .digest('hex')
    .slice(0, 48);
  return `repository-read:${digest}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A reused operation id must name the same read, or the caller gets 409. */
async function assertOperationNotReused({
  ctx,
  key,
  projectId,
  executionTargetId,
  capability,
  resourceKey,
  input
}: {
  ctx: ServiceContext;
  key: string;
  projectId: string;
  executionTargetId: string;
  capability: string;
  resourceKey: string;
  input: Record<string, unknown>;
}): Promise<void> {
  const row = (await ctx.db.get(
    `SELECT project_id, execution_target_id, metadata_json FROM execution_requests
      WHERE workspace_id = ? AND idempotency_key = ? AND deleted_at IS NULL`,
    [ctx.workspace.id, key]
  )) as
    | { project_id: string; execution_target_id: string | null; metadata_json: string }
    | undefined;
  if (!row) return;
  const stored = parseLocalTargetMutation(row.metadata_json);
  const same =
    stored !== null &&
    row.project_id === projectId &&
    row.execution_target_id === executionTargetId &&
    stored.capability === capability &&
    (stored.resourceKey ?? null) === resourceKey &&
    stableJson(stored.input) === stableJson(input);
  if (!same) {
    throw new ServiceError(
      'This operationId was already used for a different repository read.',
      'operation_conflict',
      409
    );
  }
}

const FAILURE_OUTCOMES: Partial<Record<LocalTargetErrorCode, RepositoryReadOutcome>> = {
  LOCAL_TARGET_TIMEOUT: 'timeout',
  LOCAL_TARGET_UNREACHABLE: 'target_offline',
  LOCAL_TARGET_REQUIRED: 'target_offline',
  PERMISSION_DENIED: 'denied'
};

/** Fixed messages: target-side text never crosses into the result. */
const FAILURE_MESSAGES: Partial<Record<LocalTargetErrorCode, string>> = {
  LOCAL_TARGET_TIMEOUT:
    'The execution target has not answered yet; the read may still be running there.',
  LOCAL_TARGET_UNREACHABLE: 'The execution target is offline.',
  LOCAL_TARGET_REQUIRED: 'No execution target can serve this read.',
  RESOURCE_MISSING: 'The resource directory is not present on the execution target.',
  NOT_GIT_REPOSITORY: 'The resource is not a Git checkout.',
  PERMISSION_DENIED: 'The execution target cannot read this resource.',
  GIT_COMMAND_FAILED: 'Git could not complete the read on the execution target.',
  LOCAL_TARGET_UNSUPPORTED: 'The execution target does not support this read.',
  CAPABILITY_NOT_IMPLEMENTED: 'The execution target does not support this read.',
  TARGET_OPERATION_FAILED:
    'The execution target could not complete the read (its runner may need updating).'
};

interface ReadPlan {
  capability:
    | 'observeResource'
    | 'readRepositoryTree'
    | 'listBranches'
    | 'listWorktrees'
    | 'readGitStatus'
    | 'readCurrentDiff'
    | 'readRepositoryFile'
    | 'searchRepositoryText';
  input: Record<string, unknown>;
}

function planRead(request: RepositoryReadRequest, resourceId: string, repoPath: string): ReadPlan {
  const base = { resourceId, repoPath };
  switch (request.operation) {
    case 'observe':
      return { capability: 'observeResource', input: { resourceId, path: repoPath } };
    case 'tree':
      return {
        capability: 'readRepositoryTree',
        input: {
          ...base,
          subPath: request.relativePath ?? null,
          maxEntries:
            Math.min(
              request.maxEntries ?? REPOSITORY_READ_DEFAULT_BOUNDS.treeEntries,
              REPOSITORY_READ_DEFAULT_BOUNDS.treeEntriesMax
            ) + 1
        }
      };
    case 'branches':
      return { capability: 'listBranches', input: base };
    case 'worktrees':
      return {
        capability: 'listWorktrees',
        input: { worktreeRoot: '', projects: [{ primaryRepoPath: repoPath }] }
      };
    case 'git_status':
      return { capability: 'readGitStatus', input: base };
    case 'diff':
      return {
        capability: 'readCurrentDiff',
        input: {
          ...base,
          scope: request.scope,
          relativePaths: request.relativePaths ?? null,
          maxBytes: REPOSITORY_READ_DEFAULT_BOUNDS.diffBytes
        }
      };
    case 'read_file':
      return {
        capability: 'readRepositoryFile',
        input: {
          ...base,
          relativePath: request.relativePath,
          startLine: request.startLine ?? null,
          endLine: request.endLine ?? null,
          maxBytes: REPOSITORY_READ_DEFAULT_BOUNDS.readFileBytes
        }
      };
    case 'search_text':
      return {
        capability: 'searchRepositoryText',
        input: {
          ...base,
          query: request.query,
          relativePath: request.relativePath ?? null,
          caseSensitive: request.caseSensitive ?? true,
          maxHits: REPOSITORY_READ_DEFAULT_BOUNDS.searchHits,
          maxBytes: REPOSITORY_READ_DEFAULT_BOUNDS.searchBytes
        }
      };
  }
}

function isTargetValue(value: unknown): value is RepositoryReadTargetValue<unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { outcome?: unknown }).outcome === 'string' &&
    typeof (value as { observedAt?: unknown }).observedAt === 'string'
  );
}

const TARGET_OUTCOMES: readonly RepositoryReadOutcome[] = [
  'ok',
  'unavailable',
  'timeout',
  'denied',
  'binary',
  'oversized',
  'not_found'
];

function treeData(
  request: Extract<RepositoryReadRequest, { operation: 'tree' }>,
  entries: RepositoryTreeEntry[],
  targetTruncated: boolean
): { data: { entries: RepositoryTreeEntry[] }; truncated: boolean } {
  const prefix = request.relativePath ? `${request.relativePath}/` : '';
  const scoped = prefix
    ? entries.filter(entry => entry.path.startsWith(prefix) || entry.path === request.relativePath)
    : entries;
  const limit = Math.min(
    request.maxEntries ?? REPOSITORY_READ_DEFAULT_BOUNDS.treeEntries,
    REPOSITORY_READ_DEFAULT_BOUNDS.treeEntriesMax
  );
  return {
    data: { entries: scoped.slice(0, limit) },
    truncated: targetTruncated || scoped.length > limit
  };
}

function mapSuccess(
  request: RepositoryReadRequest,
  value: unknown
): Pick<RepositoryReadResult, 'outcome' | 'head' | 'branch' | 'observedAt' | 'truncated' | 'data'> {
  const now = new Date().toISOString();
  if (isTargetValue(value)) {
    const outcome = TARGET_OUTCOMES.includes(value.outcome as RepositoryReadOutcome)
      ? (value.outcome as RepositoryReadOutcome)
      : 'unavailable';
    return {
      outcome,
      head: value.head,
      branch: value.branch,
      observedAt: value.observedAt,
      truncated: value.truncated,
      data:
        outcome === 'ok'
          ? value.data
          : {
              message: value.message ?? 'The read did not complete.',
              ...(value.data && typeof value.data === 'object' ? value.data : {})
            }
    };
  }
  const v = (value ?? {}) as Record<string, unknown>;
  switch (request.operation) {
    case 'observe':
      return {
        outcome: v.state === 'missing' ? 'not_found' : 'ok',
        head: typeof v.commit === 'string' ? v.commit : null,
        branch: typeof v.branch === 'string' ? v.branch : null,
        observedAt: typeof v.observedAt === 'string' ? v.observedAt : now,
        truncated: false,
        data: { state: v.state ?? 'unknown' }
      };
    case 'tree': {
      const mapped = treeData(
        request,
        Array.isArray(v.entries) ? (v.entries as RepositoryTreeEntry[]) : [],
        v.truncated === true
      );
      return {
        outcome: 'ok',
        head: typeof v.commit === 'string' ? v.commit : null,
        branch: typeof v.branch === 'string' ? v.branch : null,
        observedAt: now,
        truncated: mapped.truncated,
        data: mapped.data
      };
    }
    case 'branches':
      return {
        outcome: 'ok',
        head: null,
        branch: typeof v.current === 'string' ? v.current : null,
        observedAt: now,
        truncated: false,
        data: { local: v.local ?? [], remote: v.remote ?? [], current: v.current ?? null }
      };
    case 'worktrees': {
      const worktrees = Array.isArray(v.worktrees)
        ? (v.worktrees as Array<Record<string, unknown>>)
        : [];
      return {
        outcome: 'ok',
        head: null,
        branch: null,
        observedAt: now,
        truncated: false,
        data: {
          worktrees: worktrees.map(w => ({
            path: w.path ?? null,
            branch: w.branch ?? null,
            dirty: w.dirty === true
          }))
        }
      };
    }
    default:
      return {
        outcome: 'unavailable',
        head: null,
        branch: null,
        observedAt: now,
        truncated: false,
        data: { message: 'Unexpected result.' }
      };
  }
}

function result(
  request: RepositoryReadRequest,
  fields: Pick<
    RepositoryReadResult,
    'outcome' | 'head' | 'branch' | 'observedAt' | 'truncated' | 'data'
  >
): RepositoryReadResult {
  const binding: RepositoryReadBinding = {
    executionTargetId: request.executionTargetId,
    projectId: request.projectId,
    resourceKey: request.resourceKey
  };
  return {
    operationId: request.operationId,
    operation: request.operation,
    binding,
    ...fields,
    bytes: Buffer.byteLength(JSON.stringify(fields.data ?? null), 'utf8')
  };
}

function unavailable(
  request: RepositoryReadRequest,
  outcome: RepositoryReadOutcome,
  message: string
): RepositoryReadResult {
  return result(request, {
    outcome,
    head: null,
    branch: null,
    observedAt: new Date().toISOString(),
    truncated: false,
    data: { message }
  });
}

/**
 * Perform one repository read for the caller in `ctx` (whose workspace owns
 * the project). Authorization of `project:read` happens before this, at the
 * route or the chat gateway; this function adds the execution-target and
 * resource checks and owns everything after them.
 */
export async function performRepositoryRead({
  ctx,
  request,
  scopeKey,
  limiter = repositoryReadLimiter,
  signal = null,
  timeoutMs = REPOSITORY_READ_DEFAULT_BOUNDS.timeoutMs,
  createProvider = defaultProviderFactory,
  queueOptions = {}
}: {
  ctx: ServiceContext;
  request: RepositoryReadRequest;
  /** Concurrency scope: a chat run id, or the caller for the route. */
  scopeKey: string;
  limiter?: RepositoryReadLimiter;
  signal?: AbortSignal | null;
  timeoutMs?: number;
  createProvider?: RepositoryReadProviderFactory;
  queueOptions?: Pick<RunnerQueueContext, 'createCompletionListener' | 'pollIntervalMs'>;
}): Promise<RepositoryReadResult> {
  const actor = ctx.actorWorkspaceUserId;
  if (!actor) throw new ServiceError('Project not found', 'not_found', 404);
  const projectId = await resolveProjectId(ctx, request.projectId);

  // The caller may only use targets they hold active access to for this project.
  const selection = await getProjectExecutionTargetSelection({ ctx, projectId });
  const target = selection.eligibleTargets.find(
    entry => entry.executionTargetId === request.executionTargetId
  );
  if (!target) {
    throw new ServiceError('Execution target not found', 'not_found', 404);
  }

  // An offline target cannot answer anything about its checkouts; say so first.
  if (!target.reachable) {
    return unavailable(request, 'target_offline', 'The execution target is offline.');
  }

  let resourceId: string;
  let repoPath: string;
  try {
    const connected = await assertObjectiveResourceConnected({
      ctx,
      projectId,
      resourceKey: request.resourceKey,
      executionTargetId: target.executionTargetId
    });
    resourceId = connected.resource.id;
    repoPath = connected.workingDirectory;
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'objective_resource_not_connected') {
      return unavailable(
        request,
        'unavailable',
        `Resource "${request.resourceKey}" is not linked as a local directory on this execution target.`
      );
    }
    throw error;
  }

  const plan = planRead(request, resourceId, repoPath);
  const key = repositoryReadIdempotencyKey(actor, request.operationId);
  await assertOperationNotReused({
    ctx,
    key,
    projectId,
    executionTargetId: target.executionTargetId,
    capability: plan.capability,
    resourceKey: request.resourceKey,
    input: plan.input
  });

  const startedAt = Date.now();
  const release = await limiter.acquire(scopeKey, timeoutMs, signal);
  if (!release) {
    return unavailable(
      request,
      'timeout',
      signal?.aborted ? 'The read was cancelled.' : 'No read slot became free before the deadline.'
    );
  }
  try {
    const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
    const provider = createProvider({
      target,
      queue: {
        ctx,
        projectId,
        missionId: null,
        resourceKey: request.resourceKey,
        operationId: key,
        signal,
        readTimeoutMs: remaining,
        ...queueOptions
      }
    });
    const method = provider[plan.capability] as unknown as (
      input: Record<string, unknown>
    ) => Promise<CapabilityResult<unknown>>;
    const answer = await method.call(provider, plan.input);
    if (!answer.ok) {
      return unavailable(
        request,
        FAILURE_OUTCOMES[answer.code] ?? 'unavailable',
        FAILURE_MESSAGES[answer.code] ?? 'The read could not be completed.'
      );
    }
    return result(request, mapSuccess(request, answer.value));
  } finally {
    release();
  }
}
