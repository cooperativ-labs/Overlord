/**
 * Postgres-only wake primitive for callers awaiting a queued local-target
 * capability result. The mirror image of `runner-queue-notify.ts`: that one
 * wakes the runner when work arrives, this one wakes the caller when the result
 * lands. SQLite has no NOTIFY, so `waitForLocalTargetMutationResult` falls back
 * to its bounded poll when no listener can be armed.
 */

import type { LocalTargetMutationCompletionListenerFactory } from '../../packages/core/service/local-target-mutations.ts';

import { armPostgresListener } from './pg-listen.ts';

const COMPLETION_CHANNEL = 'overlord_execution_request_completed';

/** Bound LISTEN `connect()` so a hung Postgres handshake cannot stall a caller. */
export const COMPLETION_LISTEN_CONNECT_TIMEOUT_MS = 3_000;
/** Never hold one LISTEN longer than this; the waiter re-reads and re-arms. */
export const COMPLETION_LISTEN_MAX_WAIT_MS = 25_000;

/**
 * Build the listener factory `RunnerQueueProvider` hands to the waiter.
 *
 * Returns `null` (so the waiter polls) when there is no Postgres URL, or when
 * arming LISTEN fails for any reason — a wake hint is an optimization, never a
 * correctness requirement.
 */
export function createCompletionListenerFactory({
  connectionString = process.env.DATABASE_URL,
  maxWaitMs = COMPLETION_LISTEN_MAX_WAIT_MS,
  connectTimeoutMs = COMPLETION_LISTEN_CONNECT_TIMEOUT_MS,
  createClient
}: {
  connectionString?: string;
  maxWaitMs?: number;
  connectTimeoutMs?: number;
  createClient?: Parameters<typeof armPostgresListener>[0]['createClient'];
} = {}): LocalTargetMutationCompletionListenerFactory | null {
  if (!connectionString) return null;
  return async ({ timeoutMs }) => {
    const listener = await armPostgresListener({
      connectionString,
      channel: COMPLETION_CHANNEL,
      connectTimeoutMs,
      createClient
    });
    if (!listener) return null;
    // The notification payload names one request; every waiter on this backend
    // shares the channel, so a wake means "re-read your row", not "yours is done".
    const waitMs = Math.max(0, Math.min(timeoutMs, maxWaitMs));
    return {
      wait: () => listener.wait(waitMs),
      close: listener.close
    };
  };
}
