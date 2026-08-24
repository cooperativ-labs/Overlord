/** Postgres-only wake primitive for runner claim long-polls. */
const QUEUE_CHANNEL = 'overlord_execution_request_queue';

export const RUNNER_CLAIM_LONG_POLL_MS = 25_000;
/** Bound LISTEN `connect()` so a hung Postgres handshake cannot sit until a proxy 502. */
export const RUNNER_QUEUE_LISTEN_CONNECT_TIMEOUT_MS = 3_000;

type NotificationClient = {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: 'notification' | 'error', listener: (value: unknown) => void): void;
};

export interface RunnerQueueListener {
  wait(): Promise<void>;
  close(): Promise<void>;
}

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

/** Create and arm a dedicated non-pooled listener. Resolves after LISTEN is active. */
export async function createRunnerQueueListener({
  connectionString = process.env.DATABASE_URL,
  timeoutMs = RUNNER_CLAIM_LONG_POLL_MS,
  connectTimeoutMs = RUNNER_QUEUE_LISTEN_CONNECT_TIMEOUT_MS,
  createClient
}: {
  connectionString?: string;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  createClient?: (connectionString: string) => Promise<NotificationClient>;
} = {}): Promise<RunnerQueueListener | null> {
  if (!connectionString) return null;
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
    await client.query(`LISTEN ${QUEUE_CHANNEL}`);
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
  client.on('notification', finish);
  client.on('error', finish);
  return {
    wait: () =>
      new Promise<void>(resolve => {
        const timer = setTimeout(finish, timeoutMs);
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
}

/**
 * After the initial empty claim, wait on LISTEN (or fall back immediately when
 * the listener cannot be armed). `onListenArmed` fires only when we are about
 * to wait — the HTTP layer flushes headers there, with no body bytes yet.
 */
export async function longPollRunnerClaim<T>({
  claimNow,
  createListener = createRunnerQueueListener,
  onListenArmed
}: {
  claimNow: () => Promise<T | null>;
  createListener?: () => Promise<RunnerQueueListener | null>;
  onListenArmed?: () => void;
}): Promise<{ request: T | null; longPoll: boolean }> {
  const listener = await createListener();
  if (!listener) return { request: null, longPoll: false };
  try {
    const afterListen = await claimNow();
    if (afterListen) return { request: afterListen, longPoll: true };
    onListenArmed?.();
    await listener.wait();
    return { request: await claimNow(), longPoll: true };
  } finally {
    await listener.close();
  }
}
