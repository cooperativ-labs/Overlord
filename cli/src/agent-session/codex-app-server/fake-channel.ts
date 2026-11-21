import type { ChannelClient, ChannelClientResult } from '../client.js';

/**
 * An in-memory session channel for the recorded-frame fixtures and the live recording script.
 *
 * Responses are scripted per `"METHOD /path"` key and consumed in order; an unscripted call gets
 * the route's neutral answer (no input to claim, event accepted, request open). Every call is
 * recorded so a fixture can assert the exact cards, outcomes and input reports the adapter sent.
 */

export type ChannelCall = { method: 'GET' | 'POST'; path: string; body?: unknown };

export type ScriptedResponse =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'unauthorized' | 'network' | 'server' | 'timeout' };

export function createFakeChannel({
  script = {},
  onCall
}: {
  script?: Record<string, unknown[]>;
  onCall?: (call: ChannelCall) => void;
} = {}): ChannelClient & { calls: ChannelCall[] } {
  const calls: ChannelCall[] = [];
  const queues = new Map<string, unknown[]>(
    Object.entries(script).map(([key, values]) => [key, [...values]])
  );
  let nextRequest = 1;

  const answer = (method: 'GET' | 'POST', path: string): ScriptedResponse => {
    const queue = queues.get(`${method} ${path}`);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      if (next && typeof next === 'object' && (next as { ok?: unknown }).ok === false) {
        return next as ScriptedResponse;
      }
      return { ok: true, value: next };
    }
    if (path === '/events') return { ok: true, value: { accepted: [{ duplicate: false }] } };
    if (path === '/inputs/claim') return { ok: true, value: { input: null } };
    if (path === '/requests' && method === 'POST') {
      const requestId = `req-${nextRequest}`;
      nextRequest += 1;
      return { ok: true, value: { requestId, status: 'open' } };
    }
    if (/^\/requests\/[^/]+\/lease$/.test(path)) {
      return { ok: true, value: { leaseId: 'lease-1', status: 'open', resolution: null } };
    }
    if (/^\/inputs\/[^/]+\/emitted$/.test(path)) return { ok: true, value: { emitted: true } };
    return { ok: true, value: { ok: true } };
  };

  const record = (call: ChannelCall): void => {
    calls.push(call);
    onCall?.(call);
  };

  return {
    calls,
    post: async <T>(path: string, body?: unknown): Promise<ChannelClientResult<T>> => {
      record({ method: 'POST', path, body: body ?? {} });
      return answer('POST', path) as ChannelClientResult<T>;
    },
    get: async <T>(path: string): Promise<ChannelClientResult<T>> => {
      record({ method: 'GET', path });
      return answer('GET', path) as ChannelClientResult<T>;
    }
  };
}
