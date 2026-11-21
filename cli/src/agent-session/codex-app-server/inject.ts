import type { ChannelClient } from '../client.js';

import type { ThreadTracker } from './events.js';
import { JSON_RPC_ERRORS, textInput } from './protocol.js';
import { type JsonRpcPeer, RpcError } from './rpc.js';

/**
 * Overlord inbox → Codex: steering, new turns, and interrupt.
 *
 * The routing is a closed two-way choice made from thread state, and `resolveInjectPath` in
 * `../inbox.ts` delegates here so there is one mapping for the whole runtime:
 *  - a turn is running → `turn/steer` with `expectedTurnId` (mid-turn: the text becomes a user
 *    message inside the running turn);
 *  - no turn is running → `turn/start` (turn boundary / next turn).
 *
 * Both report **Delivered**: Codex accepted the input into the turn the agent is processing.
 * If the turn ends between the routing decision and the steer, Codex refuses the precondition
 * (`-32600`) and the input starts a new turn instead — still Delivered, never retried blindly.
 */

export type CodexInjectPath = 'codex-app-server-steer' | 'codex-app-server-turn-start';

export function codexAppServerInjectPath(payload: unknown): CodexInjectPath {
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const active = record?.activeTurnId;
  return typeof active === 'string' && active !== ''
    ? 'codex-app-server-steer'
    : 'codex-app-server-turn-start';
}

export type ClaimedInput = { id: string; kind: string; body: string; leaseId: string };

export type InjectOutcome = 'delivered' | 'failed';

export async function injectClaimedInput({
  rpc,
  client,
  tracker,
  input
}: {
  rpc: JsonRpcPeer;
  client: ChannelClient;
  tracker: ThreadTracker;
  input: ClaimedInput;
}): Promise<{ outcome: InjectOutcome; path: CodexInjectPath | 'codex-app-server-steer-fallback' }> {
  const threadId = tracker.threadId;
  if (!threadId) {
    await client.post(`/inputs/${encodeURIComponent(input.id)}/failed`, {
      errorCode: 'codex_no_thread'
    });
    return { outcome: 'failed', path: 'codex-app-server-turn-start' };
  }
  const path = codexAppServerInjectPath({ activeTurnId: tracker.activeTurnId });
  let usedPath: CodexInjectPath | 'codex-app-server-steer-fallback' = path;
  try {
    if (path === 'codex-app-server-steer') {
      try {
        await rpc.request('turn/steer', {
          threadId,
          input: textInput(input.body),
          expectedTurnId: tracker.activeTurnId
        });
      } catch (error) {
        if (!(error instanceof RpcError) || error.code !== JSON_RPC_ERRORS.invalidRequest) {
          throw error;
        }
        // The turn ended (or a newer one started) after routing: start a new turn instead.
        usedPath = 'codex-app-server-steer-fallback';
        tracker.activeTurnId = null;
        await startTurn({ rpc, tracker, threadId, body: input.body });
      }
    } else {
      await startTurn({ rpc, tracker, threadId, body: input.body });
    }
  } catch (error) {
    await client.post(`/inputs/${encodeURIComponent(input.id)}/failed`, {
      errorCode:
        error instanceof RpcError && error.code === -1 ? 'codex_transport_closed' : 'codex_rejected'
    });
    return { outcome: 'failed', path: usedPath };
  }
  const emitted = await client.post<{ emitted: boolean }>(
    `/inputs/${encodeURIComponent(input.id)}/emitted`,
    { leaseId: input.leaseId, deliveryOutcome: 'delivered' }
  );
  if (emitted.ok && emitted.value.emitted) {
    await client.post(`/inputs/${encodeURIComponent(input.id)}/acknowledged`, {});
  }
  return { outcome: 'delivered', path: usedPath };
}

async function startTurn({
  rpc,
  tracker,
  threadId,
  body
}: {
  rpc: JsonRpcPeer;
  tracker: ThreadTracker;
  threadId: string;
  body: string;
}): Promise<void> {
  const started = await rpc.request<{ turn?: { id?: unknown } }>('turn/start', {
    threadId,
    input: textInput(body)
  });
  // The new turn is the active one from now on, even before `turn/started` arrives.
  if (typeof started?.turn?.id === 'string') tracker.activeTurnId = started.turn.id;
}

/** Stop the running turn. Resolves `false` when no turn is running. */
export async function interruptActiveTurn({
  rpc,
  tracker
}: {
  rpc: JsonRpcPeer;
  tracker: ThreadTracker;
}): Promise<boolean> {
  if (!tracker.threadId || !tracker.activeTurnId) return false;
  try {
    await rpc.request('turn/interrupt', {
      threadId: tracker.threadId,
      turnId: tracker.activeTurnId
    });
    return true;
  } catch {
    return false;
  }
}
