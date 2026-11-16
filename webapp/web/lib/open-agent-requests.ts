import type { AgentRequestListResponse, HumanAgentRequestDto } from '@overlord/contract';

import { isPendingBlockingRequest } from './objective-blocking-requests.ts';

/**
 * The complete open-request collection for a mission (or one objective).
 *
 * The server filters `status=open` before its page limit and pages oldest first on
 * (createdAt, id), so following every cursor yields every open request — an old open question can
 * no longer be displaced by newer closed ones the way it can in the legacy newest-200 read.
 *
 * Completeness is explicit. A collection is authoritative only when the last read succeeded and
 * reached a page with `page.complete`; a read that stopped early (page bound, cursor loop, or a
 * server without the paged extension) is `partial`. Callers must never treat absence from a
 * partial or failed collection as "no open request": pruning dismissals, acknowledging, or
 * clearing a blocked tint all require `authoritative`.
 */

/** Requests per page. The server accepts 1–200. */
export const OPEN_REQUEST_PAGE_LIMIT = 200;
/** Upper bound on pages per collection read: 50 × 200 = 10,000 open requests. */
export const OPEN_REQUEST_MAX_PAGES = 50;

export type OpenAgentRequestCollection = {
  /** Open requests of every kind, deduplicated by id, oldest first. */
  requests: HumanAgentRequestDto[];
  /** True only when the read followed every page to `page.complete`. */
  complete: boolean;
  /** Pages read. */
  pages: number;
};

export type FetchOpenRequestPage = (cursor: string | null) => Promise<AgentRequestListResponse>;

function compareRequests(a: HumanAgentRequestDto, b: HumanAgentRequestDto): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Read every page. Any failed page rejects the whole read, so the caller's query keeps its last
 * successful collection rather than replacing it with a truncated one.
 */
export async function fetchCompleteOpenAgentRequests(
  fetchPage: FetchOpenRequestPage,
  { maxPages = OPEN_REQUEST_MAX_PAGES }: { maxPages?: number } = {}
): Promise<OpenAgentRequestCollection> {
  const byId = new Map<string, HumanAgentRequestDto>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  let complete = false;
  while (pages < maxPages) {
    const response = await fetchPage(cursor);
    pages += 1;
    // A later page wins: it was read more recently than an earlier copy of the same request.
    for (const request of response.requests) {
      if (request.status === 'open') byId.set(request.id, request);
    }
    const page = response.page;
    // A server without the paged extension answers the legacy shape: never claim completeness.
    if (!page) break;
    if (page.complete || page.nextCursor === null) {
      complete = page.complete && page.nextCursor === null;
      break;
    }
    if (seenCursors.has(page.nextCursor)) break;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return { requests: [...byId.values()].sort(compareRequests), complete, pages };
}

/** Open question/choice requests: the ones that block an objective. */
export function blockingOpenRequests(
  requests: readonly HumanAgentRequestDto[]
): HumanAgentRequestDto[] {
  return requests.filter(isPendingBlockingRequest);
}

/** Group requests by objective id, preserving the collection's oldest-first order. */
export function groupOpenRequestsByObjective(
  requests: readonly HumanAgentRequestDto[]
): Map<string, HumanAgentRequestDto[]> {
  const grouped = new Map<string, HumanAgentRequestDto[]>();
  for (const request of requests) {
    if (!request.objectiveId) continue;
    const list = grouped.get(request.objectiveId);
    if (list) list.push(request);
    else grouped.set(request.objectiveId, [request]);
  }
  return grouped;
}

export type OpenAgentRequestState = 'loading' | 'complete' | 'partial' | 'error';

/**
 * Collapse query state into one signal.
 *
 * - `loading`: no collection has been read yet.
 * - `error`: the latest read failed. `requests` still holds the last successful collection, if
 *   any (`stale`), so the UI keeps showing it with a retry instead of claiming nothing is open.
 * - `partial`: the latest read succeeded but did not reach the last page.
 * - `complete`: the latest read succeeded and reached the last page; only this is authoritative.
 */
export function openAgentRequestState(input: {
  hasData: boolean;
  isError: boolean;
  complete: boolean;
}): OpenAgentRequestState {
  if (input.isError) return 'error';
  if (!input.hasData) return 'loading';
  return input.complete ? 'complete' : 'partial';
}
