import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { api } from '../api.ts';
import { getApiBaseUrl, isDesktopShell } from '../api-base.ts';
import { fetchApi } from '../api-transport.ts';
import { useMeta, useProfile } from '../queries/profile.ts';
import { keys } from '../query-keys.ts';

import { ChatPresence, chatTabClientId, isDocumentForeground } from './presence.ts';
import { pruneRequestIds } from './request-ids.ts';
import { type ChatStreamView, ChatThreadStream } from './thread-stream.ts';

export type ChatAvailability =
  | { kind: 'loading' }
  | { kind: 'local' }
  | { kind: 'no_organization' }
  | { kind: 'ready'; scope: string };

/**
 * Chat is Cloud-only and private to one profile in one organization. The scope
 * string (backend origin, profile, organization) keys every cache, stream, and
 * stored request id, so switching account, organization, or desktop backend
 * profile tears the old state down instead of showing it to the new identity.
 */
export function useChatAvailability(): ChatAvailability {
  const meta = useMeta();
  const profile = useProfile();
  const organizationId = meta.data?.organization?.id ?? null;
  const userId = profile.data?.userId ?? null;
  const backend = getApiBaseUrl() || (typeof window === 'undefined' ? '' : window.location.origin);
  const result = useMemo<ChatAvailability>(() => {
    if (meta.isPending || profile.isPending) return { kind: 'loading' };
    if (meta.data?.backendMode === 'local') return { kind: 'local' };
    if (!organizationId || !userId) return { kind: 'no_organization' };
    return { kind: 'ready', scope: `${backend}|${userId}|${organizationId}` };
  }, [meta.isPending, profile.isPending, meta.data?.backendMode, organizationId, userId, backend]);
  const scope = result.kind === 'ready' ? result.scope : null;
  useEffect(() => {
    if (scope) pruneRequestIds(scope);
  }, [scope]);
  return result;
}

export function useChatThreads(scope: string | null, archived = false) {
  return useQuery({
    queryKey: keys.chatThreads(scope ?? 'none', archived),
    queryFn: () => api.listChatThreads({ archived }),
    enabled: scope !== null
  });
}

export function useChatProviders(scope: string | null) {
  return useQuery({
    queryKey: keys.chatProviders(scope ?? 'none'),
    queryFn: api.getChatProviders,
    enabled: scope !== null,
    // Readiness and connection state change outside this tab (sign-in in another window).
    refetchOnWindowFocus: true
  });
}

const IDLE_VIEW: ChatStreamView = { state: null, status: 'loading', snapshotLoads: 0 };

/** Snapshot plus live events for one thread, torn down when the thread or scope changes. */
export function useChatThreadStream(threadId: string | null, scope: string | null) {
  const queryClient = useQueryClient();
  const [stream, setStream] = useState<ChatThreadStream | null>(null);

  useEffect(() => {
    if (!threadId || !scope) {
      setStream(null);
      return;
    }
    const next = new ChatThreadStream(threadId, {
      loadSnapshot: (id, before) => api.getChatSnapshot(id, before),
      poll: (id, after) => api.pollChatEvents(id, after),
      openStream: (id, after, signal) =>
        fetchApi(api.chatEventStreamPath(id, after), {
          headers: { Accept: 'text/event-stream' },
          signal
        })
    });
    setStream(next);
    next.start();
    const wake = () => next.wake();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') next.wake();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', onVisibility);
      next.stop();
    };
  }, [threadId, scope]);

  const view = useSyncExternalStore(
    stream?.subscribe ?? noopSubscribe,
    stream?.getView ?? idleView,
    stream?.getView ?? idleView
  );

  // Keep the thread list's title, activity, and run badge in step with the open thread.
  const thread = view.state?.thread;
  const listSignature = thread
    ? `${thread.id}|${thread.revision}|${thread.activeRunState ?? ''}|${thread.lastActivityAt}`
    : null;
  useEffect(() => {
    if (!scope || !listSignature) return;
    void queryClient.invalidateQueries({ queryKey: ['chat', scope, 'threads'] });
  }, [queryClient, scope, listSignature]);

  return { stream, view };
}

function noopSubscribe(): () => void {
  return () => undefined;
}
function idleView(): ChatStreamView {
  return IDLE_VIEW;
}

/**
 * Foreground presence for the open thread, plus acknowledgement of the events
 * this tab has rendered. `renderedSeq` must come from committed UI state; the
 * effect runs after React commits, so nothing is acknowledged before it is shown.
 */
export function useChatPresence(threadId: string | null, renderedSeq: number | null) {
  const presence = useRef<ChatPresence | null>(null);

  useEffect(() => {
    if (!threadId) return;
    const current = new ChatPresence(
      threadId,
      { updatePresence: api.updateChatPresence, ack: api.ackChatEvents },
      { clientId: chatTabClientId(), platform: isDesktopShell() ? 'desktop' : 'web' }
    );
    presence.current = current;
    const update = () => current.setForeground(isDocumentForeground());
    const leave = () => current.setForeground(false);
    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('pagehide', leave);
      current.stop();
      if (presence.current === current) presence.current = null;
    };
  }, [threadId]);

  useEffect(() => {
    if (renderedSeq !== null && renderedSeq > 0) presence.current?.rendered(renderedSeq);
  }, [renderedSeq, threadId]);
}
