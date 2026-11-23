import { asRecordOrNull } from '../../records.js';

import type { ThreadTree } from './threads.js';

/**
 * Thread history import: fill the session feed and the change ledger with work Overlord did not
 * see live.
 *
 * The supervisor observes a session through notifications, and notifications are not replayed:
 * anything a thread did while the socket was down (server crash and respawn, a dropped
 * connection, a supervisor started with `--thread-id` on an existing thread) is otherwise
 * missing from the session's events and its delivery change evidence. Codex keeps the history,
 * and `thread/turns/list` pages it.
 *
 * It never duplicates what is already captured, by construction rather than by bookkeeping:
 *  - Each completed item is replayed as the `item/completed` notification it was, through the
 *    same projection, codec and capture path as live frames. Item and turn ids in history equal
 *    the live ones (LIVE 0.170), and event ids are content-derived, so the server drops a
 *    replayed event it already has; the change ledger appends a path once and keeps health codes
 *    as a set.
 *  - A fork's history starts with its source's turns (same turn ids, LIVE 0.170: "paging works
 *    across forked thread histories"). Turns already imported in this pass are skipped, and the
 *    tree is walked root first, so an inherited turn is attributed to the thread that ran it.
 *  - Only items in a terminal state are replayed. A turn still running is reported live.
 *  - Model text (agent messages, reasoning) has no codec rule, so it is never imported:
 *    the transcript keeps what the live feed keeps — prompts, tool calls and their outcomes,
 *    file edits and subagent lifecycle — and nothing else.
 *
 * Subagents spawned while Overlord was away are found with `thread/list {parentThreadId}`, one
 * level at a time (`ancestorThreadId` is newer and not relied on).
 */

export const HISTORY_PAGE_LIMIT = 20;
export const HISTORY_MAX_PAGES = 50;
const MAX_TREE_THREADS = 64;

/** Item types whose completed form the codec maps. Everything else is skipped before projection. */
const REPLAYED_ITEM_TYPES = new Set([
  'userMessage',
  'commandExecution',
  'fileChange',
  'subAgentActivity',
  'collabAgentToolCall'
]);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'declined']);

export type HistoryRpc = {
  request<T>(method: string, params?: unknown): Promise<T>;
};

export type HistoryReplay = (
  method: 'item/completed',
  params: Record<string, unknown>,
  occurredAt: Date | null
) => void | Promise<void>;

export type HistoryImportResult = {
  threads: number;
  turns: number;
  items: number;
  skippedInheritedTurns: number;
  pages: number;
  failedThreads: number;
};

type Turn = {
  id?: unknown;
  status?: unknown;
  completedAt?: unknown;
  startedAt?: unknown;
  items?: unknown;
};

function replayable(item: Record<string, unknown>): boolean {
  if (typeof item.type !== 'string' || !REPLAYED_ITEM_TYPES.has(item.type)) return false;
  if (item.type === 'userMessage' || item.type === 'subAgentActivity') return true;
  return typeof item.status === 'string' && TERMINAL_STATUSES.has(item.status);
}

function itemTime(item: Record<string, unknown>, turn: Turn): Date | null {
  if (typeof item.completedAtMs === 'number') return new Date(item.completedAtMs);
  const seconds =
    typeof turn.completedAt === 'number'
      ? turn.completedAt
      : typeof turn.startedAt === 'number'
        ? turn.startedAt
        : null;
  return seconds === null ? null : new Date(seconds * 1000);
}

/** Page one thread's turns, oldest first, and replay its completed items. */
export async function importThreadTurns({
  rpc,
  threadId,
  seenTurns,
  replay,
  pageLimit = HISTORY_PAGE_LIMIT,
  maxPages = HISTORY_MAX_PAGES,
  shouldStop = () => false
}: {
  rpc: HistoryRpc;
  threadId: string;
  /** Turn ids already imported in this pass (shared across the tree). */
  seenTurns: Set<string>;
  replay: HistoryReplay;
  pageLimit?: number;
  maxPages?: number;
  /** The session is ending: stop paging. */
  shouldStop?: () => boolean;
}): Promise<Pick<HistoryImportResult, 'turns' | 'items' | 'skippedInheritedTurns' | 'pages'>> {
  const result = { turns: 0, items: 0, skippedInheritedTurns: 0, pages: 0 };
  let cursor: string | null = null;
  for (let page = 0; page < maxPages && !shouldStop(); page += 1) {
    const response: { data?: unknown; nextCursor?: unknown } = await rpc.request(
      'thread/turns/list',
      { threadId, cursor, limit: pageLimit, sortDirection: 'asc', itemsView: 'full' }
    );
    result.pages += 1;
    for (const raw of Array.isArray(response?.data) ? response.data : []) {
      const turn = (asRecordOrNull(raw) ?? {}) as Turn;
      if (typeof turn.id !== 'string') continue;
      if (seenTurns.has(turn.id)) {
        result.skippedInheritedTurns += 1;
        continue;
      }
      seenTurns.add(turn.id);
      if (turn.status === 'inProgress') continue;
      result.turns += 1;
      for (const entry of Array.isArray(turn.items) ? turn.items : []) {
        const item = asRecordOrNull(entry);
        if (!item || !replayable(item)) continue;
        result.items += 1;
        await replay('item/completed', { threadId, turnId: turn.id, item }, itemTime(item, turn));
      }
    }
    cursor = typeof response?.nextCursor === 'string' ? response.nextCursor : null;
    if (!cursor) break;
  }
  return result;
}

/**
 * Import the history of every thread in the session tree in admission order: the root first,
 * then subagents (found live or by `thread/list {parentThreadId}`) and forks. A fork's source is
 * always admitted before the fork, so the source's turns are imported under the source.
 * A thread whose history cannot be read (an ephemeral thread, a server that refuses) is
 * counted and skipped; the import never fails the session.
 */
export async function importSessionHistory({
  rpc,
  tree,
  replay,
  pageLimit,
  maxPages,
  shouldStop = () => false
}: {
  rpc: HistoryRpc;
  tree: ThreadTree;
  replay: HistoryReplay;
  pageLimit?: number;
  maxPages?: number;
  shouldStop?: () => boolean;
}): Promise<HistoryImportResult> {
  const result: HistoryImportResult = {
    threads: 0,
    turns: 0,
    items: 0,
    skippedInheritedTurns: 0,
    pages: 0,
    failedThreads: 0
  };
  if (!tree.rootId) return result;
  const seenTurns = new Set<string>();
  const done = new Set<string>();
  const listed = new Set<string>();
  for (;;) {
    const next = tree.threads().find(node => !done.has(node.id));
    if (!next || done.size >= MAX_TREE_THREADS || shouldStop()) break;
    done.add(next.id);
    try {
      const imported = await importThreadTurns({
        rpc,
        threadId: next.id,
        seenTurns,
        replay,
        shouldStop,
        ...(pageLimit ? { pageLimit } : {}),
        ...(maxPages ? { maxPages } : {})
      });
      result.threads += 1;
      result.turns += imported.turns;
      result.items += imported.items;
      result.skippedInheritedTurns += imported.skippedInheritedTurns;
      result.pages += imported.pages;
    } catch {
      result.failedThreads += 1;
    }
    if (!listed.has(next.id)) {
      listed.add(next.id);
      try {
        const children: { data?: unknown } = await rpc.request('thread/list', {
          parentThreadId: next.id,
          limit: 50
        });
        for (const child of Array.isArray(children?.data) ? children.data : []) {
          tree.admitThread(child);
        }
      } catch {
        // Listing children is best effort; live announcements still admit them.
      }
    }
  }
  return result;
}
