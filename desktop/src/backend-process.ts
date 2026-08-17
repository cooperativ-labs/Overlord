/**
 * Supervisor for a single long-lived child process.
 *
 * This module deliberately imports nothing from Electron so the lifecycle rules
 * it encodes can be unit tested. `server.ts` binds it to an Electron
 * `utilityProcess`; the tests bind it to a fake process table.
 *
 * The rules it exists to guarantee:
 *
 * - **At most one process.** `start()` never forks a second child while one is
 *   still alive, and a late `exit` event from an already-replaced child can
 *   never clear the handle of the current one (the old code closed over a
 *   module-level variable, so a stale exit orphaned the live process).
 * - **Stopping reaps.** `stop()` resolves only once the child has actually
 *   exited, escalating to a force kill if it ignores the graceful signal. Every
 *   backend-profile transition and app shutdown awaits this, so a Remote
 *   profile can never inherit a still-running Local backend.
 */

export interface SupervisedChild {
  readonly pid?: number;
  kill(): boolean;
  once(event: 'exit', listener: (code: number | null) => void): void;
}

export interface ProcessSupervisorOptions<TChild extends SupervisedChild> {
  /** Fork the child. Called only when no child is currently running. */
  fork: () => TChild;
  /** Escalation used when the child ignores the graceful kill. */
  forceKill?: (pid: number) => void;
  /** How long to wait for a graceful exit before escalating. */
  graceMs?: number;
  /** How long to wait after escalating before giving up on the reap. */
  forceMs?: number;
  onEvent?: (message: string) => void;
}

export interface ProcessSupervisor<TChild extends SupervisedChild> {
  start: () => TChild;
  stop: () => Promise<void>;
  isRunning: () => boolean;
  pid: () => number | null;
  /** The live child, or null. Exposed for diagnostics. */
  current: () => TChild | null;
}

export function createProcessSupervisor<TChild extends SupervisedChild>({
  fork,
  forceKill = pid => process.kill(pid, 'SIGKILL'),
  graceMs = 5_000,
  forceMs = 2_000,
  onEvent = () => {}
}: ProcessSupervisorOptions<TChild>): ProcessSupervisor<TChild> {
  let current: TChild | null = null;
  let stopping: Promise<void> | null = null;

  function start(): TChild {
    if (current) {
      onEvent(`start ignored; process ${current.pid ?? '?'} is already running`);
      return current;
    }
    const child = fork();
    current = child;
    // Bind the listener to *this* child, never to whatever happens to be
    // current when the event finally arrives.
    child.once('exit', code => {
      if (current === child) current = null;
      onEvent(`process ${child.pid ?? '?'} exited with code ${code}`);
    });
    onEvent(`process ${child.pid ?? '?'} started`);
    return child;
  }

  function stop(): Promise<void> {
    if (stopping) return stopping;
    const child = current;
    if (!child) return Promise.resolve();

    stopping = reap(child)
      .catch(error => {
        onEvent(`reap failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (current === child) current = null;
        stopping = null;
      });
    return stopping;
  }

  async function reap(child: TChild): Promise<void> {
    const exited = waitForExit(child);
    child.kill();
    if (await raceTimeout(exited, graceMs)) return;

    const { pid } = child;
    if (typeof pid === 'number') {
      onEvent(`process ${pid} ignored the graceful stop; escalating`);
      try {
        forceKill(pid);
      } catch (error) {
        // ESRCH means it is already gone, which is the outcome we wanted.
        onEvent(`force kill of ${pid} failed: ${describe(error)}`);
      }
    }
    if (!(await raceTimeout(exited, forceMs))) {
      onEvent(`process ${pid ?? '?'} did not exit after escalation`);
    }
  }

  function waitForExit(child: TChild): Promise<void> {
    return new Promise<void>(resolve => {
      const listener = () => resolve();
      child.once('exit', listener);
    });
  }

  return {
    start,
    stop,
    isRunning: () => current !== null,
    pid: () => current?.pid ?? null,
    current: () => current
  };
}

async function raceTimeout(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), ms);
    timer.unref?.();
  });
  const result = await Promise.race([promise.then(() => 'exited' as const), timeout]);
  if (timer) clearTimeout(timer);
  return result === 'exited';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
