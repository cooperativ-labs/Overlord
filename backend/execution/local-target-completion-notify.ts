/**
 * Postgres-only wake primitive for callers awaiting a queued local-target
 * capability result. The mirror image of `runner-queue-notify.ts`: that one
 * wakes the runner when work arrives, this one wakes the caller when the result
 * lands. SQLite has no NOTIFY, so `waitForLocalTargetMutationResult` falls back
 * to its bounded poll when no listener can be armed.
 */

import type { LocalTargetMutationCompletionListenerFactory } from '../../packages/core/service/local-target-mutations.ts';

const COMPLETION_CHANNEL = 'overlord_execution_request_completed';

/** Bound LISTEN `connect()` so a hung Postgres handshake cannot stall a caller. */
export const COMPLETION_LISTEN_CONNECT_TIMEOUT_MS = 3_000;
/** Never hold one LISTEN longer than this; the waiter re-reads and re-arms. */
export const COMPLETION_LISTEN_MAX_WAIT_MS = 25_000;

type NotificationClient = {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: 'notification' | 'error', listener: (value: unknown) => void): void;
};

async function connectWithTimeout({
  client,
  timeoutMs
}: {
  client: NotificationClient;
  timeoutMs: number;
}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connectPromise = Promise.resolve(client.connect());
  try {
    await Promise.race([
      connectPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`LISTEN connect timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // If the race lost to the timeout, a later connect rejection must not become unhandled.
    void connectPromise.catch(() => undefined);
  }
}

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
  createClient?: (connectionString: string) => Promise<NotificationClient>;
} = {}): LocalTargetMutationCompletionListenerFactory | null {
  if (!connectionString) return null;
  return async ({ timeoutMs }) => {
    const client = createClient
      ? await createClient(connectionString)
      : await (async () => {
          const pg = await import('pg');
          const Client = (pg.default ?? pg).Client;
          return new Client({
            connectionString,
            connectionTimeoutMillis: connectTimeoutMs
          }) as NotificationClient;
        })();
    try {
      await connectWithTimeout({ client, timeoutMs: connectTimeoutMs });
      await client.query(`LISTEN ${COMPLETION_CHANNEL}`);
    } catch {
      await client.end().catch(() => undefined);
      return null;
    }

    let settled = false;
    let resolveWait: (() => void) | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolveWait?.();
    };
    // The notification payload names one request; every waiter on this backend
    // shares the channel, so a wake means "re-read your row", not "yours is done".
    client.on('notification', finish);
    client.on('error', finish);
    const waitMs = Math.max(0, Math.min(timeoutMs, maxWaitMs));
    return {
      wait: () =>
        new Promise<void>(resolve => {
          const timer = setTimeout(finish, waitMs);
          resolveWait = () => {
            clearTimeout(timer);
            resolve();
          };
          if (settled) resolveWait();
        }),
      close: async () => {
        settled = true;
        await client.end().catch(() => undefined);
      }
    };
  };
}
