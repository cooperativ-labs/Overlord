const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

/**
 * Shared mechanics for the backend's in-process polling loops: one interval
 * timer, a re-entrancy guard so a slow pass never overlaps the next, a
 * per-pass gate, catch-and-log, and an explicit stop. Subclasses own only what
 * a pass does (`runOnce`) and, when needed, how a failure is reported.
 *
 * `unref` is opt-in: an unref'd loop never keeps the process alive on its own.
 * `runOnStart` drives one pass immediately instead of waiting a full interval.
 */
export abstract class PollLoop<T = void> {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<T | undefined> | null = null;
  private stopped = false;
  private readonly intervalMs: number;
  private readonly unref: boolean;
  private readonly runOnStart: boolean;
  protected readonly logPrefix: string;

  protected constructor({
    intervalMs,
    logPrefix,
    unref = false,
    runOnStart = false
  }: {
    intervalMs: number;
    logPrefix: string;
    unref?: boolean;
    runOnStart?: boolean;
  }) {
    this.intervalMs = intervalMs;
    this.logPrefix = logPrefix;
    this.unref = unref;
    this.runOnStart = runOnStart;
  }

  /** Idempotent; a stopped loop may be started again. */
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    if (this.unref) this.timer.unref();
    if (this.runOnStart) void this.poll();
  }

  /**
   * Clears the timer and refuses further passes, including `pollNow()` nudges.
   * Resolves once a pass already in flight has finished; it never rejects.
   */
  stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.inFlight ? this.inFlight.then(() => undefined) : Promise.resolve();
  }

  /** Drives one pass without waiting for the next interval; never rejects. */
  async pollNow(): Promise<void> {
    await this.poll();
  }

  /** True once `stop()` has been called and until the next `start()`. */
  protected get isStopped(): boolean {
    return this.stopped;
  }

  /** Per-pass gate; a false result skips the pass entirely. */
  protected shouldPoll(): boolean {
    return true;
  }

  /** One unit of work. Thrown errors are routed to `onPollError`. */
  protected abstract runOnce(): Promise<T>;

  protected onPollError(error: unknown): void {
    console.error(`[${this.logPrefix}] poll failed`, error);
  }

  /**
   * One guarded pass. Returns `undefined` when the pass was skipped (another
   * pass in flight, stopped, or gated off) or failed. Protected so subclasses
   * and tests can await a pass directly.
   */
  protected poll(): Promise<T | undefined> {
    if (this.inFlight || this.stopped || !this.shouldPoll()) return Promise.resolve(undefined);
    const pass = this.runGuarded();
    this.inFlight = pass;
    return pass;
  }

  private async runGuarded(): Promise<T | undefined> {
    try {
      return await this.runOnce();
    } catch (error) {
      this.onPollError(error);
      return undefined;
    } finally {
      this.inFlight = null;
    }
  }
}

export interface StoppableLoop {
  stop(): void | Promise<void>;
}

/**
 * Stops background loops when the process is asked to terminate, then lets the
 * signal take its default effect. A listener for SIGTERM or SIGINT replaces
 * Node's default termination, so the one-shot listener re-sends the signal once
 * every loop has stopped (bounded by `drainTimeoutMs` for a pass still in
 * flight); otherwise the backend would keep serving after a deploy's SIGTERM
 * with its workers already stopped. A second signal during the drain takes the
 * default effect immediately. Work interrupted anyway is reclaimed when its
 * lease lapses.
 */
export function stopOnTermination(
  loops: readonly StoppableLoop[],
  {
    target = process,
    drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS
  }: {
    target?: Pick<NodeJS.Process, 'once' | 'kill' | 'pid'>;
    drainTimeoutMs?: number;
  } = {}
): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    target.once(signal, () => {
      const stopped = loops.map(loop => {
        try {
          return Promise.resolve(loop.stop()).catch(() => undefined);
        } catch {
          return Promise.resolve();
        }
      });
      let timeout: NodeJS.Timeout | undefined;
      const deadline = new Promise<void>(resolve => {
        timeout = setTimeout(resolve, drainTimeoutMs);
        timeout.unref();
      });
      void Promise.race([Promise.all(stopped), deadline]).finally(() => {
        clearTimeout(timeout);
        target.kill(target.pid, signal);
      });
    });
}
