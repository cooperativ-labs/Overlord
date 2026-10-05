import type { ChatRunFailureCode } from '@overlord/contract';
import { randomUUID } from 'node:crypto';

import {
  type ChatAttempt,
  ChatRuns,
  type RuntimeIdentity,
  StaleChatAttempt
} from '../packages/core/service/chat/runs.ts';

export interface ChatRuntime {
  identity: RuntimeIdentity;
  execute(attempt: ChatAttempt, runs: ChatRuns, signal: AbortSignal): Promise<void>;
}
export class ChatRuntimeFailure extends Error {
  constructor(readonly failureCode: ChatRunFailureCode) {
    super(failureCode);
  }
}
/** No mock answers in production. Phase C injects the real provider runtime. */
export const unavailableChatRuntime: ChatRuntime = {
  identity: {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    configDigest: 'unconfigured',
    checkpointVersion: 1
  },
  execute: async () => {
    throw new ChatRuntimeFailure('provider_unavailable');
  }
};
/**
 * Stops background chat work when the process is asked to terminate, then lets the
 * signal take its default effect. A listener for SIGTERM or SIGINT replaces Node's
 * default termination, so the one-shot listener re-sends the signal after stopping;
 * otherwise the backend would keep serving after a deploy's SIGTERM with its chat
 * worker already stopped. Interrupted attempts are reclaimed when their lease lapses.
 */
export function stopOnTermination(
  stop: () => void,
  target: Pick<NodeJS.Process, 'once' | 'kill' | 'pid'> = process
): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    target.once(signal, () => {
      try {
        stop();
      } finally {
        target.kill(target.pid, signal);
      }
    });
}
export class ChatWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private lastRetentionAt = 0;
  private stopping = false;
  private readonly active = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private readonly id = randomUUID();
  constructor(
    private readonly store: () => ChatRuns,
    private readonly runtime: ChatRuntime = unavailableChatRuntime,
    private readonly concurrency = 4
  ) {}
  start() {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, 500);
    this.timer.unref();
    void this.tick();
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const job of this.active.values()) job.controller.abort();
    // Do not wait on a provider ignoring abort. Its lease expires and a future claim fences it.
  }
  async tick() {
    if (this.polling || this.stopping) return;
    this.polling = true;
    try {
      if (Date.now() - this.lastRetentionAt >= 60_000) {
        await this.store().retainExpired();
        this.lastRetentionAt = Date.now();
      }
      while (this.active.size < this.concurrency && !this.stopping) {
        const runs = this.store(),
          attempt = await runs.claim(this.id, this.runtime.identity);
        if (!attempt) break;
        const controller = new AbortController();
        const promise = this.execute(runs, attempt, controller).finally(() =>
          this.active.delete(attempt.id)
        );
        this.active.set(attempt.id, { controller, promise });
      }
    } catch {
      /* No provider state or raw database errors enter logs. Next tick retries. */
    } finally {
      this.polling = false;
    }
  }
  private async execute(runs: ChatRuns, attempt: ChatAttempt, controller: AbortController) {
    let renewing = false;
    const renew = setInterval(
      () => {
        if (renewing || controller.signal.aborted) return;
        renewing = true;
        void runs
          .heartbeat(attempt)
          .then(keep => {
            if (!keep) controller.abort();
          })
          .catch(() => controller.abort())
          .finally(() => {
            renewing = false;
          });
      },
      Math.max(10, Math.floor(runs.limits.attemptLeaseMs / 3))
    );
    renew.unref();
    try {
      await Promise.race([
        this.runtime.execute(attempt, runs, controller.signal),
        new Promise<void>(resolve =>
          controller.signal.addEventListener('abort', () => resolve(), { once: true })
        )
      ]);
      if (!controller.signal.aborted) {
        // A runtime must explicitly complete or ask. An unexplained return is interrupted.
        try {
          await runs.fail(attempt, 'interrupted');
        } catch (error) {
          if (!(error instanceof StaleChatAttempt)) throw error;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof StaleChatAttempt))
        await runs
          .fail(attempt, error instanceof ChatRuntimeFailure ? error.failureCode : 'provider_error')
          .catch(() => {});
    } finally {
      clearInterval(renew);
    }
  }
}
