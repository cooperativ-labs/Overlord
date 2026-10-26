type NotificationClient = {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: 'notification' | 'error', listener: (value: unknown) => void): void;
};

export interface PostgresListener {
  wait(timeoutMs: number): Promise<void>;
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
export async function armPostgresListener({
  connectionString,
  channel,
  connectTimeoutMs,
  createClient
}: {
  connectionString?: string;
  channel: string;
  connectTimeoutMs: number;
  createClient?: (connectionString: string) => Promise<NotificationClient>;
}): Promise<PostgresListener | null> {
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
    await client.query(`LISTEN ${channel}`);
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
    wait: timeoutMs =>
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
