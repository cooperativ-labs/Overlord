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
  client: Pick<NotificationClient, 'connect'>;
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

/** Subscribe on a dedicated session. Postgres channels are internal constants. */
export async function subscribePostgres({
  connectionString,
  channel,
  onWake,
  onDisconnect
}: {
  connectionString: string;
  channel: string;
  onWake: () => void;
  onDisconnect: () => void;
}): Promise<() => Promise<void>> {
  const { default: pg } = await import('pg');
  const timeoutMs = 3_000;
  const client = new pg.Client({
    connectionString,
    application_name: channel,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await client.end().catch(() => undefined);
  };
  const disconnected = () => {
    if (closed) return;
    void close();
    onDisconnect();
  };
  client.on('error', disconnected);
  client.on('end', disconnected);
  client.on('notification', notice => {
    if (!closed && notice.channel === channel) onWake();
  });
  try {
    await connectWithTimeout({ client, timeoutMs });
    await client.query(`LISTEN ${channel}`);
    if (closed) throw new Error('Postgres listener disconnected while arming');
    return close;
  } catch (error) {
    await close();
    throw error;
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
