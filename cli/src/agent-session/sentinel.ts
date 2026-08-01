import { removeChannelCredential } from './channel.js';
import { type ChannelClient, createChannelClient } from './client.js';

/**
 * The channel sentinel: heartbeat while alive, report the exit when dying.
 *
 * Kept deliberately small. The temptation with a per-launch supervising process is to grow it
 * into a message broker — let it hold the connection, route inputs, cache decisions — and the
 * parent design rejects that explicitly. A broker in this position becomes a single point of
 * failure that is *also* the thing reporting its own health, and every addressable-runner
 * design that has been tried here ended up routing work to a process that had silently died.
 *
 * So the sentinel does exactly two things:
 *
 * - **renew the lease**, which is what `online` means and the only thing it means; and
 * - **report a clean exit**, which revokes the credential and releases every open request in
 *   one transaction.
 *
 * Everything that could be lost when this process dies is already covered server-side by lease
 * expiry. The sentinel makes the common case fast and honest; it is not what makes the system
 * correct.
 */

/** Renew well inside the server's lease so one dropped beat is not a lost channel. */
export const HEARTBEAT_INTERVAL_MS = 45_000;

export type Sentinel = {
  stop: (options?: { reason?: string; exitCode?: number | null }) => Promise<void>;
};

export function startChannelSentinel({
  baseUrl,
  channelId,
  token,
  intervalMs = HEARTBEAT_INTERVAL_MS,
  client = createChannelClient({ baseUrl, channelId, token })
}: {
  baseUrl: string;
  channelId: string;
  token: string;
  intervalMs?: number;
  client?: ChannelClient;
}): Sentinel {
  let stopped = false;

  const beat = async (): Promise<void> => {
    if (stopped) return;
    const result = await client.post('/heartbeat', { state: 'online' });
    // An unauthorized heartbeat means the channel ended or was revoked elsewhere. Stop beating
    // rather than retrying forever against a credential the server has already refused.
    if (!result.ok && result.reason === 'unauthorized') {
      stopped = true;
      clearInterval(timer);
    }
  };

  const timer = setInterval(() => {
    void beat();
  }, intervalMs);
  // Never hold the process open. A sentinel that keeps a finished agent's shell alive is a bug
  // the user experiences as "the terminal won't close", which is far more annoying than a
  // slightly late channel end.
  timer.unref?.();
  void beat();

  const stop = async ({
    reason = 'session_ended',
    exitCode = null
  }: { reason?: string; exitCode?: number | null } = {}): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    // Short timeout: this runs on the exit path, and a slow backend must not delay a process
    // that is trying to die. If it does not land, lease expiry reaches the same terminal state.
    await client.post('/end', { reason, exitCode }, { timeoutMs: 1500 });
    removeChannelCredential(channelId);
  };

  return { stop };
}

/**
 * Register clean-exit reporting for a process that owns a channel.
 *
 * `SIGINT`/`SIGTERM` are handled; `SIGKILL` cannot be, which is precisely why the server-side
 * lease sweep exists and why the answerable-request UI was gated on it landing first.
 */
export function registerChannelExitHandlers(sentinel: Sentinel): void {
  let firing = false;
  const finish = (reason: string, exitCode: number | null): void => {
    if (firing) return;
    firing = true;
    void sentinel.stop({ reason, exitCode });
  };
  process.once('SIGINT', () => finish('interrupted', 130));
  process.once('SIGTERM', () => finish('terminated', 143));
  process.once('beforeExit', code => finish('session_ended', code));
}
