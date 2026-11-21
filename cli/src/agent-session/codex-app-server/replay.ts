import type { CodecSpec } from '@overlord/core/service/agent-session/pure/codec';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

import { createFakeChannel } from './fake-channel.js';
import { runCodexAppServerSupervisor, type SupervisorResult } from './supervisor.js';
import type { MessageTransport } from './transport.js';

/**
 * Recorded-frame replay: run the real supervisor against a scripted fake app server and an
 * in-memory channel, and report every message the supervisor sends.
 *
 * This is what the `script-io` fixtures of `connectors/adapters/codex-app-server/` execute (via
 * `scripts/codex-app-server-replay.mjs`). Each step either sends recorded server frames or waits
 * until the supervisor has sent a given message, so the exchange is deterministic: a frame is
 * released only after the client message it answers exists, exactly as on a live connection.
 *
 * Script: the first entry is `{ "setup": {...} }`; the rest are steps:
 *   { "server": <frame> }                      send one frame to the supervisor
 *   { "await": { "method": "turn/steer" } }    wait for a client message with this method
 *   { "await": { "id": 0 } }                   wait for a client message with this id
 *   { "await": { "channel": "POST /path" } }   wait for a channel call
 *   { "stop": true }                           Overlord stops the session (abort signal)
 * When the steps run out the fake server closes the connection.
 *
 * Output: one line per reported message, `{ "id": "out-<n>", "rpc": <message> }` or
 * `{ "id": "out-<n>", "channel": { method, path, body } }`, then `{ "id": "result", ... }`.
 */

export type ReplaySetup = {
  codec: string;
  cwd: string;
  threadId?: string | null;
  firstPrompt?: string | null;
  threadSettings?: Record<string, unknown>;
  /** Import the thread tree's history after a resume (`history.ts`). */
  importHistory?: boolean;
  /** Scripted channel responses by `"METHOD /path"`. */
  channel?: Record<string, unknown[]>;
  /** Channel paths to report (exact, or a prefix ending in `/` or `-`). RPC is always reported. */
  report?: string[];
};

export type ReplayStep =
  | { server: unknown }
  | { await: { method?: string; id?: number | string; channel?: string } }
  | { stop: true };

type Output = { id: string; rpc?: unknown; channel?: unknown } & Record<string, unknown>;

export async function runReplay({
  setup,
  steps,
  repoRoot,
  awaitTimeoutMs = 3000
}: {
  setup: ReplaySetup;
  steps: ReplayStep[];
  repoRoot: string;
  awaitTimeoutMs?: number;
}): Promise<Output[]> {
  const codec = parseYaml(readFileSync(`${repoRoot}/${setup.codec}`, 'utf8')) as CodecSpec;
  const outputs: Output[] = [];
  let counter = 0;
  const sentByClient: Record<string, unknown>[] = [];
  const channelCalls: string[] = [];
  const waiters: (() => void)[] = [];
  const wake = (): void => {
    for (const waiter of waiters.splice(0)) waiter();
  };

  const reports = (path: string): boolean =>
    (setup.report ?? []).some(entry =>
      entry.endsWith('/') || entry.endsWith('-') ? path.startsWith(entry) : path === entry
    );
  const channel = createFakeChannel({
    script: setup.channel ?? {},
    onCall: call => {
      channelCalls.push(`${call.method} ${call.path}`);
      if (reports(call.path)) {
        counter += 1;
        outputs.push({ id: `out-${counter}`, channel: call });
      }
      wake();
    }
  });

  const listeners: ((text: string) => void)[] = [];
  const closeListeners: ((reason: string) => void)[] = [];
  let closed = false;
  const transport: MessageTransport = {
    send: text => {
      const message = JSON.parse(text) as Record<string, unknown>;
      sentByClient.push(message);
      counter += 1;
      outputs.push({ id: `out-${counter}`, rpc: message });
      wake();
    },
    onMessage: listener => listeners.push(listener),
    onClose: listener => closeListeners.push(listener),
    close: () => {
      if (closed) return;
      closed = true;
      for (const listener of closeListeners) listener('closed');
    }
  };

  const controller = new AbortController();
  const running = runCodexAppServerSupervisor({
    codec,
    client: channel,
    connect: async () => transport,
    cwd: setup.cwd,
    clientVersion: 'replay',
    threadId: setup.threadId ?? null,
    firstPrompt: setup.firstPrompt ?? null,
    ...(setup.threadSettings ? { threadSettings: setup.threadSettings as never } : {}),
    ...(setup.importHistory ? { importHistory: true } : {}),
    maxReconnects: 0,
    heartbeatIntervalMs: 0,
    injectIntervalMs: 0,
    reconcileWindowMs: 0,
    sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5))),
    stopSignal: controller.signal,
    now: () => new Date('2026-01-01T00:00:00.000Z')
  });

  const satisfied = (condition: { method?: string; id?: number | string; channel?: string }) => {
    if (condition.channel !== undefined) return channelCalls.includes(condition.channel);
    return sentByClient.some(
      message =>
        (condition.method === undefined || message.method === condition.method) &&
        (condition.id === undefined || message.id === condition.id)
    );
  };

  let failure: string | null = null;
  for (const step of steps) {
    if ('server' in step) {
      // Deliver on a later turn of the event loop, as a socket would.
      await new Promise(resolve => setImmediate(resolve));
      const text = JSON.stringify(step.server);
      for (const listener of listeners) listener(text);
      continue;
    }
    if ('stop' in step) {
      controller.abort();
      continue;
    }
    const condition = step.await;
    const deadline = Date.now() + awaitTimeoutMs;
    while (!satisfied(condition)) {
      if (Date.now() > deadline) {
        failure = `timed out waiting for ${JSON.stringify(condition)}`;
        break;
      }
      await new Promise<void>(resolve => {
        waiters.push(resolve);
        setTimeout(resolve, 20);
      });
    }
    if (failure) break;
  }

  await new Promise(resolve => setTimeout(resolve, 20));
  transport.close();
  const result: SupervisorResult = await running;
  outputs.push({
    id: 'result',
    reason: result.reason,
    serverVersion: result.serverVersion,
    threadId: result.threadId,
    injected: result.injected,
    interrupted: result.interrupted,
    // Reported only when a session had child threads or imported history, so fixtures that
    // exercise neither keep their exact result line.
    ...(result.childThreads ? { childThreads: result.childThreads } : {}),
    ...(result.historyItems ? { historyItems: result.historyItems } : {}),
    ...(failure ? { failure } : {})
  });
  return outputs;
}
