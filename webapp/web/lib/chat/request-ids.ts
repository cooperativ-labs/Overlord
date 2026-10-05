/**
 * Stable client request ids for idempotent chat actions. An id is minted the
 * first time an action is attempted and reused by every retry of the same
 * action until it succeeds, so a lost response is recovered from the server's
 * receipt instead of performing the action twice. Ids are kept in
 * `localStorage` (scoped to backend, profile, and organization) so a reload
 * after a lost Create response still replays the original request; storage
 * failures fall back to memory.
 */
const memory = new Map<string, string>();
const PREFIX = 'overlord.chat.request.';

function storageKey(scope: string, action: string): string {
  return `${PREFIX}${scope}|${action}`;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function stableRequestId(scope: string, action: string): string {
  const key = storageKey(scope, action);
  const existing = memory.get(key) ?? storage()?.getItem(key) ?? null;
  if (existing) {
    memory.set(key, existing);
    return existing;
  }
  const id = globalThis.crypto.randomUUID();
  memory.set(key, id);
  try {
    storage()?.setItem(key, id);
  } catch {
    /* memory only */
  }
  return id;
}

/** Forget an action's id once the server has confirmed it (or the action changed). */
export function clearRequestId(scope: string, action: string): void {
  const key = storageKey(scope, action);
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Drop every stored id for other scopes, e.g. after sign-out or an account switch. */
export function pruneRequestIds(activeScope: string | null): void {
  for (const key of [...memory.keys()])
    if (!activeScope || !key.startsWith(`${PREFIX}${activeScope}|`)) memory.delete(key);
  const store = storage();
  if (!store) return;
  try {
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX) && (!activeScope || !key.startsWith(`${PREFIX}${activeScope}|`)))
        store.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
