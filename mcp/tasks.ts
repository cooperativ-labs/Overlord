import { randomUUID } from 'node:crypto';

/**
 * MCP task-augmented execution for hosted tool calls (MCP 2025-11-25, "Tasks", experimental).
 *
 * A client that sees `capabilities.tasks.requests.tools.call` and a tool whose
 * `execution.taskSupport` is `optional` may send `tools/call` with `params.task`. The server then
 * answers at once with a `CreateTaskResult`, runs the handler in the background, and the client
 * polls `tasks/get` and reads the tool result with `tasks/result`.
 *
 * The store is process memory. The backend runs one replica, so a task lives exactly as long as the
 * process that created it: a restart or a rollout loses unfinished bookkeeping (never the write
 * itself, which commits or not through the Protocol exactly as a synchronous call would). Every
 * task-capable tool is replay-safe through a caller-retained `operationId` and readable afterwards
 * with `overlord_delivery_receipt`, which is how a client recovers from a lost task.
 *
 * Tasks are bound to the caller's authorization context (profile, USER_TOKEN and workspace user).
 * Another caller's task id answers exactly like an unknown id, so ids cannot be probed.
 */

export type McpTaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export type McpTask = {
  taskId: string;
  status: McpTaskStatus;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttl: number;
  pollInterval: number;
};

/** The CallToolResult shape a task settles with. */
export type McpTaskToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

/** JSON-RPC error a task operation answers with; `code` is the JSON-RPC error code. */
export class McpTaskError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'McpTaskError';
    this.code = code;
  }
}

/** JSON-RPC "Invalid params": unknown, expired or foreign task id, bad cursor, bad `task`. */
export const MCP_INVALID_PARAMS = -32602;
/** Server error: the caller already has the maximum number of unfinished tasks. */
export const MCP_SERVER_ERROR = -32000;

export const RELATED_TASK_META_KEY = 'io.modelcontextprotocol/related-task';
export const MODEL_IMMEDIATE_RESPONSE_META_KEY = 'io.modelcontextprotocol/model-immediate-response';

export type McpTaskLimits = {
  /** ttl used when the request names none. */
  defaultTtlMs: number;
  /** Largest ttl honored; a larger request is lowered to this. */
  maxTtlMs: number;
  /** Suggested interval between `tasks/get` polls. */
  pollIntervalMs: number;
  /** Unfinished tasks one caller may hold at once. */
  maxActivePerOwner: number;
  /** Tasks one `tasks/list` page returns. */
  listPageSize: number;
  /** Longest statusMessage kept for a failed task. */
  maxStatusMessageLength: number;
  /**
   * Least time a finished task stays readable after it settles, so a task that outran its ttl can
   * still be polled to its result once.
   */
  resultGraceMs: number;
};

export const DEFAULT_MCP_TASK_LIMITS: McpTaskLimits = {
  defaultTtlMs: 15 * 60_000,
  maxTtlMs: 60 * 60_000,
  pollIntervalMs: 2_000,
  maxActivePerOwner: 10,
  listPageSize: 50,
  maxStatusMessageLength: 500,
  resultGraceMs: 60_000
};

type TaskRecord = {
  owner: string;
  task: McpTask;
  createdAtMs: number;
  settledAtMs: number | null;
  settled: Promise<McpTaskToolResult>;
  result: McpTaskToolResult | null;
};

export type McpTaskStoreOptions = {
  limits?: Partial<McpTaskLimits>;
  now?: () => number;
  newId?: () => string;
  /** Called once when a task reaches a terminal status (for example to nudge poll loops). */
  onSettled?: (task: McpTask) => void;
};

function terminal(status: McpTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function firstText(result: McpTaskToolResult): string {
  const text = result.content.find(item => item.type === 'text')?.text ?? '';
  return text.split('\n')[0] ?? '';
}

function failureResult(error: unknown): McpTaskToolResult {
  const message =
    error instanceof Error ? error.message : 'Overlord could not complete this tool call.';
  return { content: [{ type: 'text', text: message }], isError: true };
}

export class McpTaskStore {
  private readonly records = new Map<string, TaskRecord>();
  private readonly limits: McpTaskLimits;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly onSettled: ((task: McpTask) => void) | undefined;

  constructor(options: McpTaskStoreOptions = {}) {
    this.limits = { ...DEFAULT_MCP_TASK_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
    this.onSettled = options.onSettled;
  }

  /**
   * Validates `params.task` and returns the ttl to grant. `undefined` means no task was requested.
   * The requested ttl is honored up to the maximum; the granted value is what every response reports.
   */
  grantedTtl(taskParam: unknown): number | undefined {
    if (taskParam === undefined) return undefined;
    if (taskParam === null || typeof taskParam !== 'object' || Array.isArray(taskParam)) {
      throw new McpTaskError(MCP_INVALID_PARAMS, 'params.task must be an object');
    }
    const ttl = (taskParam as Record<string, unknown>).ttl;
    if (ttl === undefined) return this.limits.defaultTtlMs;
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
      throw new McpTaskError(
        MCP_INVALID_PARAMS,
        'params.task.ttl must be a positive number of milliseconds'
      );
    }
    return Math.min(Math.trunc(ttl), this.limits.maxTtlMs);
  }

  /**
   * Starts `run` in the background as a task owned by `owner` and returns the task in `working`.
   * `run` must not throw for tool-level failures (it returns an `isError` result); a throw is
   * still recorded as a failed task rather than escaping.
   */
  create(owner: string, ttl: number, run: () => Promise<McpTaskToolResult>): McpTask {
    this.sweep();
    let active = 0;
    for (const record of this.records.values()) {
      if (record.owner === owner && !terminal(record.task.status)) active += 1;
    }
    if (active >= this.limits.maxActivePerOwner) {
      throw new McpTaskError(
        MCP_SERVER_ERROR,
        `Too many unfinished Overlord tasks (limit ${this.limits.maxActivePerOwner}); wait for one to finish or call the tool without a task`
      );
    }

    const nowMs = this.now();
    const stamp = new Date(nowMs).toISOString();
    const task: McpTask = {
      taskId: this.newId(),
      status: 'working',
      statusMessage: 'Overlord is running the tool call.',
      createdAt: stamp,
      lastUpdatedAt: stamp,
      ttl,
      pollInterval: this.limits.pollIntervalMs
    };
    const record: TaskRecord = {
      owner,
      task,
      createdAtMs: nowMs,
      settledAtMs: null,
      result: null,
      settled: Promise.resolve()
        .then(run)
        .catch(failureResult)
        .then(result => {
          this.settle(record, result);
          return result;
        })
    };
    this.records.set(task.taskId, record);
    return { ...task };
  }

  get(owner: string, taskId: unknown): McpTask {
    return { ...this.lookup(owner, taskId).task };
  }

  /** Waits for the task to finish and returns the tool result with related-task metadata. */
  async result(owner: string, taskId: unknown): Promise<McpTaskToolResult> {
    const record = this.lookup(owner, taskId);
    const result = record.result ?? (await record.settled);
    return {
      ...result,
      _meta: { ...result._meta, [RELATED_TASK_META_KEY]: { taskId: record.task.taskId } }
    };
  }

  /** The caller's tasks, newest first, `listPageSize` per page. */
  list(owner: string, cursor: unknown): { tasks: McpTask[]; nextCursor?: string } {
    this.sweep();
    let offset = 0;
    if (cursor !== undefined) {
      const parsed = typeof cursor === 'string' && /^\d+$/.test(cursor) ? Number(cursor) : NaN;
      if (!Number.isSafeInteger(parsed)) {
        throw new McpTaskError(MCP_INVALID_PARAMS, 'Invalid tasks/list cursor');
      }
      offset = parsed;
    }
    const owned = [...this.records.values()]
      .filter(record => record.owner === owner)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
    const page = owned.slice(offset, offset + this.limits.listPageSize);
    const next = offset + page.length;
    return {
      tasks: page.map(record => ({ ...record.task })),
      ...(next < owned.length ? { nextCursor: String(next) } : {})
    };
  }

  /**
   * Drops finished tasks whose ttl has passed and whose grace after settling has run out.
   * Unfinished tasks are kept until they settle.
   */
  sweep(): void {
    const nowMs = this.now();
    for (const [taskId, record] of this.records) {
      if (record.settledAtMs === null) continue;
      const expiresAt = Math.max(
        record.createdAtMs + record.task.ttl,
        record.settledAtMs + this.limits.resultGraceMs
      );
      if (nowMs >= expiresAt) this.records.delete(taskId);
    }
  }

  private lookup(owner: string, taskId: unknown): TaskRecord {
    if (typeof taskId !== 'string' || !taskId) {
      throw new McpTaskError(MCP_INVALID_PARAMS, 'params.taskId is required');
    }
    this.sweep();
    const record = this.records.get(taskId);
    // A foreign task answers exactly like a missing one.
    if (!record || record.owner !== owner) {
      throw new McpTaskError(MCP_INVALID_PARAMS, 'Failed to retrieve task: Task not found');
    }
    return record;
  }

  private settle(record: TaskRecord, result: McpTaskToolResult): void {
    record.result = result;
    record.settledAtMs = this.now();
    const status: McpTaskStatus = result.isError === true ? 'failed' : 'completed';
    const statusMessage =
      status === 'failed'
        ? `Tool execution failed: ${firstText(result)}`.slice(0, this.limits.maxStatusMessageLength)
        : 'The tool call finished. Read the result with tasks/result.';
    record.task = {
      ...record.task,
      status,
      statusMessage,
      lastUpdatedAt: new Date(this.now()).toISOString()
    };
    try {
      this.onSettled?.({ ...record.task });
    } catch {
      // A listener failure must not change the task's outcome.
    }
  }
}
