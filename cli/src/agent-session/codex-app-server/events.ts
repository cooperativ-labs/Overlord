import {
  type CodecSpec,
  normalizeNativeEvent
} from '@overlord/core/service/agent-session/pure/codec';
import type { NormalizedEvent } from '@overlord/core/service/agent-session/pure/envelope';

import type { ThreadFrameContext } from './threads.js';

/**
 * Codex app-server notifications → projected frames → normalized events.
 *
 * The projection is the only place the transport adds anything to a native frame, and what it
 * adds is what the transport knows and the frame does not:
 *  - `event`: the native event name. Codex names a notification by its JSON-RPC `method`, and
 *    for `item/started` / `item/completed` the item type decides what happened, so the name is
 *    `method` or `method:item.type` (for example `item/completed:commandExecution`).
 *    A `subAgentActivity` item's meaning is its `kind`, so it is named
 *    `method:subAgentActivity:<kind>` (for example `item/completed:subAgentActivity:started`).
 *  - `context.cwd`: the thread's working directory. File-change items carry absolute paths but
 *    no cwd, and evidence paths are only kept when they relativize inside the project root.
 *  - `context.rootThreadId` / `context.subagentThreadId` / `context.parentThreadId` /
 *    `context.lineage`: where the frame's thread sits in the session's thread tree
 *    (`threads.ts`). The codec correlates every frame with the root thread and records a child
 *    thread as the event's `subagentId`.
 *
 * A `fileChange` item is fanned out to one frame per change, carrying that change as `change`,
 * so a multi-file patch records every path and a rename keeps both endpoints. The connector
 * codec (`connectors/adapters/codex-app-server/codec/codex-app-server.codec.yaml`) decides what
 * leaves the machine; this module never reads diffs, output, or message text.
 */

export type ProjectedFrame = Record<string, unknown> & {
  event: string;
  context: { cwd: string | null } & Partial<ThreadFrameContext>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function nativeEventName(method: string, params: unknown): string {
  if (method === 'item/started' || method === 'item/completed') {
    const item = asRecord(asRecord(params)?.item);
    const type = item?.type;
    if (typeof type === 'string' && type) {
      if (type === 'subAgentActivity' && typeof item?.kind === 'string' && item.kind) {
        return `${method}:${type}:${item.kind}`;
      }
      return `${method}:${type}`;
    }
  }
  return method;
}

export function projectNotification({
  method,
  params,
  cwd,
  thread = null
}: {
  method: string;
  params: unknown;
  cwd: string | null;
  /** The frame's place in the session thread tree; `null` before the root is bound. */
  thread?: ThreadFrameContext | null;
}): ProjectedFrame[] {
  const record = asRecord(params) ?? {};
  const event = nativeEventName(method, params);
  const base: ProjectedFrame = { ...record, event, context: { cwd, ...(thread ?? {}) } };
  const item = asRecord(record.item);
  if (item?.type === 'fileChange' && Array.isArray(item.changes)) {
    return item.changes.map((change, changeIndex) => ({ ...base, change, changeIndex }));
  }
  return [base];
}

export function normalizeProjectedFrame({
  codec,
  frame,
  now = new Date()
}: {
  codec: CodecSpec;
  frame: ProjectedFrame;
  now?: Date;
}): NormalizedEvent | null {
  try {
    return normalizeNativeEvent({
      codec,
      payload: frame,
      nativeEventName: frame.event,
      occurredAt: now.toISOString()
    });
  } catch {
    // A codec that throws produces no event rather than a partial one.
    return null;
  }
}

/** Thread-level state the supervisor tracks from the stream. */
export type ThreadTracker = {
  threadId: string | null;
  activeTurnId: string | null;
  /** `waitingOnApproval` / `waitingOnUserInput` while a turn is blocked on a client. */
  activeFlags: string[];
  /** Pre-mutation file-change evidence by item id, joined to the later patch approval. */
  fileChanges: Map<string, { path: string; kind: string }[]>;
};

export function createThreadTracker(threadId: string | null = null): ThreadTracker {
  return { threadId, activeTurnId: null, activeFlags: [], fileChanges: new Map() };
}

/**
 * Update the tracker from one notification. Returns nothing; pure state transition.
 *
 * Turn and status state is the root thread's: inbox input is steered into the root, and a child
 * thread's turns run inside the root's. Pre-mutation file changes are kept for every thread,
 * because a subagent's patch approval reaches this connection too and its card is joined to the
 * child's `item/started` by item id.
 */
export function trackNotification(tracker: ThreadTracker, method: string, params: unknown): void {
  const record = asRecord(params);
  if (!record) return;
  const otherThread =
    Boolean(tracker.threadId) &&
    typeof record.threadId === 'string' &&
    record.threadId !== tracker.threadId;
  if (otherThread && method !== 'item/started' && method !== 'item/completed') return;
  if (method === 'turn/started') {
    const id = asRecord(record.turn)?.id;
    if (typeof id === 'string') tracker.activeTurnId = id;
    return;
  }
  if (method === 'turn/completed') {
    // A thread runs one turn at a time, so any completed turn leaves the thread idle.
    tracker.activeTurnId = null;
    tracker.activeFlags = [];
    return;
  }
  if (method === 'thread/status/changed') {
    const status = asRecord(record.status);
    if (status?.type === 'active' && Array.isArray(status.activeFlags)) {
      tracker.activeFlags = status.activeFlags.filter(
        (flag): flag is string => typeof flag === 'string'
      );
    } else {
      tracker.activeFlags = [];
      if (status?.type === 'idle' || status?.type === 'systemError') tracker.activeTurnId = null;
    }
    return;
  }
  if (method === 'item/started' || method === 'item/completed') {
    const item = asRecord(record.item);
    if (item?.type !== 'fileChange' || typeof item.id !== 'string') return;
    if (method === 'item/completed') {
      tracker.fileChanges.delete(item.id);
      return;
    }
    const changes = Array.isArray(item.changes) ? item.changes : [];
    tracker.fileChanges.set(
      item.id,
      changes
        .map(change => asRecord(change))
        .filter((change): change is Record<string, unknown> => change !== null)
        .map(change => ({
          path: typeof change.path === 'string' ? change.path : '',
          kind:
            typeof asRecord(change.kind)?.type === 'string'
              ? (asRecord(change.kind)!.type as string)
              : 'update'
        }))
        .filter(change => change.path !== '')
    );
  }
}
