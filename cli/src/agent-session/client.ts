import { removeChannelCredential } from './channel.js';

/**
 * The only client that speaks to `/api/agent-session-channels/v1/*`.
 *
 * Three rules distinguish it from `cli/src/backend-client.ts`, and each of them is a rule
 * rather than a preference:
 *
 * 1. **It presents the channel credential and nothing else.** It never reads `USER_TOKEN`, and
 *    it has no code path that could fall back to one. A failed adapter call that retried with
 *    the user's broad credential would turn a transient backend error into a privilege
 *    escalation, so the escalation is made impossible rather than merely unlikely.
 * 2. **It is silent on failure.** No stderr, no log file, no retry storm. The caller's contract
 *    with the harness is "produce no output unless you have something correct to say", and a
 *    diagnostic printed into a hook's stderr is output.
 * 3. **It is bounded.** Every call carries a timeout, because the call path sits in front of a
 *    human waiting at a terminal. A hung request that would eventually succeed is worse than a
 *    fast failure that defers to the harness.
 */

export type ChannelClientResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'unauthorized' | 'network' | 'server' | 'timeout' };

const DEFAULT_TIMEOUT_MS = 5000;

export type ChannelClient = {
  post: <T>(
    path: string,
    body?: unknown,
    options?: { timeoutMs?: number }
  ) => Promise<ChannelClientResult<T>>;
  get: <T>(path: string, options?: { timeoutMs?: number }) => Promise<ChannelClientResult<T>>;
};

export function createChannelClient({
  baseUrl,
  channelId,
  token
}: {
  baseUrl: string;
  channelId: string;
  token: string;
}): ChannelClient {
  const root = `${baseUrl.replace(/\/+$/, '')}/api/agent-session-channels/v1`;

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    timeoutMs: number
  ): Promise<ChannelClientResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${root}${path}`, {
        method,
        // The credential travels here and only here: an Authorization header on a request the
        // CLI itself constructs. Not in the URL, which lands in access logs; not in the body,
        // which lands in request dumps.
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) {
        // The channel is gone, revoked, or ended. Drop the local cache so the next process in
        // this session does not re-present a credential the server has already refused —
        // cleanup, not enforcement; the server already stopped honoring it.
        removeChannelCredential(channelId);
        return { ok: false, reason: 'unauthorized' };
      }
      if (!response.ok) return { ok: false, reason: 'server' };
      return { ok: true, value: (await response.json()) as T };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return { ok: false, reason: aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    post: (path, body, options) =>
      request('POST', path, body ?? {}, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    get: (path, options) =>
      request('GET', path, undefined, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  };
}
