import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { getActiveBackendId } from './api-base.ts';

/**
 * Which blocking-request notifications a person dismissed (mission-panel-redesign plan §5).
 *
 * Dismissing a request's notification hides its card at the top of the mission panel and of
 * the objective detail, and nothing else: the request stays open, answerable, tinted on its row
 * and listed in the detail's Blocking questions list. Dismissal is per request id, so a new
 * question from the agent shows again without any extra bookkeeping.
 *
 * Ids persist in `localStorage` so a reload does not bring a dismissed card back. Storage is
 * namespaced by backend, account, workspace and mission, so one person's dismissals never hide
 * another account's or another backend's cards. When storage is unavailable (private mode, a
 * quota error, a test environment) the store keeps working in memory for the session.
 *
 * Pruning is deliberately conservative: an id is forgotten only on an authoritative, complete,
 * successful open-request read for the same scope, or when a terminal-status event names it.
 * Loading, failed, partial or truncated reads and navigation to another mission never prune,
 * because absence from those is not proof that a request was resolved.
 */

export type DismissalScope = {
  workspaceId: string;
  missionId: string;
};

const STORAGE_PREFIX = 'overlord:dismissed-agent-requests:v1';
const ANONYMOUS_ACCOUNT = 'anonymous';

let activeAccountId = ANONYMOUS_ACCOUNT;
/** Ids per storage key; the source of truth while the page lives (and the storage fallback). */
const cache = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
const EMPTY: ReadonlySet<string> = new Set();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The storage key for a scope under the active backend and account. */
export function dismissalStorageKey(scope: DismissalScope): string {
  return [STORAGE_PREFIX, getActiveBackendId(), activeAccountId, scope.workspaceId, scope.missionId]
    .map(part => encodeURIComponent(part))
    .join(':');
}

function read(key: string): ReadonlySet<string> {
  const cached = cache.get(key);
  if (cached) return cached;
  let ids: ReadonlySet<string> = EMPTY;
  try {
    const raw = storage()?.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        ids = new Set(parsed.filter((id): id is string => typeof id === 'string'));
      }
    }
  } catch {
    // Unreadable or corrupt storage: start empty; the in-memory cache carries on.
  }
  cache.set(key, ids);
  return ids;
}

function write(key: string, ids: ReadonlySet<string>) {
  cache.set(key, ids);
  try {
    const store = storage();
    if (store) {
      if (ids.size === 0) store.removeItem(key);
      else store.setItem(key, JSON.stringify([...ids]));
    }
  } catch {
    // Storage unavailable or full: the in-memory copy keeps the dismissal for this session.
  }
  emit();
}

/**
 * Set the account dismissals are scoped to. AuthGate calls this with the signed-in user id;
 * switching accounts (or signing out) switches every subscriber to that account's scope.
 */
export function setDismissalAccount(accountId: string | null | undefined) {
  const next = accountId?.trim() || ANONYMOUS_ACCOUNT;
  if (next === activeAccountId) return;
  activeAccountId = next;
  emit();
}

export function getDismissedRequestIds(scope: DismissalScope): ReadonlySet<string> {
  return read(dismissalStorageKey(scope));
}

export function dismissAgentRequest(scope: DismissalScope, requestId: string) {
  const key = dismissalStorageKey(scope);
  const current = read(key);
  if (current.has(requestId)) return;
  write(key, new Set([...current, requestId]));
}

/**
 * Forget dismissals of requests that are no longer open. Does nothing unless `authoritative`:
 * only a complete, successful read for this same scope proves a request has closed.
 */
export function pruneDismissedAgentRequests(
  scope: DismissalScope,
  { openRequestIds, authoritative }: { openRequestIds: Iterable<string>; authoritative: boolean }
) {
  if (!authoritative) return;
  const key = dismissalStorageKey(scope);
  const current = read(key);
  if (current.size === 0) return;
  const open = new Set(openRequestIds);
  const kept = [...current].filter(id => open.has(id));
  if (kept.length === current.size) return;
  write(key, new Set(kept));
}

/** Forget dismissals of requests an explicit terminal-status event (answered, expired) named. */
export function forgetDismissedAgentRequests(scope: DismissalScope, requestIds: Iterable<string>) {
  const key = dismissalStorageKey(scope);
  const current = read(key);
  const drop = new Set(requestIds);
  const kept = [...current].filter(id => !drop.has(id));
  if (kept.length === current.size) return;
  write(key, new Set(kept));
}

/** Test hook: forget the in-memory cache and reset the account scope. */
export function resetDismissedAgentRequestsForTests() {
  cache.clear();
  activeAccountId = ANONYMOUS_ACCOUNT;
  emit();
}

/**
 * The dismissed ids for one mission, shared live by the mission panel and the objective detail,
 * plus `dismiss`. When `prune` is given, an authoritative complete read prunes closed ids.
 */
export function useDismissedAgentRequests(
  scope: DismissalScope | null,
  prune?: { openRequestIds: readonly string[]; authoritative: boolean }
) {
  const workspaceId = scope?.workspaceId ?? '';
  const missionId = scope?.missionId ?? '';
  const stableScope = useMemo<DismissalScope | null>(
    () => (missionId ? { workspaceId, missionId } : null),
    [missionId, workspaceId]
  );
  const getSnapshot = useCallback(
    () => (stableScope ? getDismissedRequestIds(stableScope) : EMPTY),
    [stableScope]
  );
  const dismissedIds = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const openKey = prune ? prune.openRequestIds.join(',') : null;
  const authoritative = prune?.authoritative ?? false;
  useEffect(() => {
    if (!stableScope || openKey === null || !authoritative) return;
    pruneDismissedAgentRequests(stableScope, {
      openRequestIds: openKey.length > 0 ? openKey.split(',') : [],
      authoritative
    });
  }, [authoritative, openKey, stableScope]);

  const dismiss = useCallback(
    (requestId: string) => {
      if (stableScope) dismissAgentRequest(stableScope, requestId);
    },
    [stableScope]
  );
  return { dismissedIds, dismiss };
}
