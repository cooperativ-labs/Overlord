import type { EntityChangeDto, SyncChangesDto } from '@overlord/contract';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';

import { getAuthorizationHeader } from './api-base.ts';
import { ApiRequestError } from './api/request.ts';
import { fetchApi, resolveEventSourceUrl } from './api-transport.ts';
import { connectEventStream } from './fetch-sse.ts';
import { invalidateNonEverhourQueries } from './query-invalidation.ts';
import { invalidateRealtimeChanges } from './realtime-invalidation.ts';

export type LinkState = 'connecting' | 'live' | 'reconnecting';

interface RealtimeValue {
  state: LinkState;
  lastSeq: number;
  lastChanges: EntityChangeDto[];
}

const RealtimeContext = createContext<RealtimeValue>({
  state: 'connecting',
  lastSeq: 0,
  lastChanges: []
});

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LinkState>('connecting');
  const [lastSeq, setLastSeq] = useState(0);
  const [lastChanges, setLastChanges] = useState<EntityChangeDto[]>([]);
  const cursorRef = useRef(0);

  useEffect(() => {
    let recovering = false;
    let recoveryPending = false;
    let changedDuringRecovery = false;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const invalidateAll = () => invalidateNonEverhourQueries(queryClient);
    const updateCursor = (cursor: number) => {
      if (!Number.isFinite(cursor) || cursor <= cursorRef.current) return;
      cursorRef.current = cursor;
      setLastSeq(cursor);
    };
    const onHello = (cursor: number) => {
      if (recoveryPending) return;
      if (cursorRef.current === 0) updateCursor(cursor);
    };
    const applyChangePayload = (payload: { cursor?: number; changes?: unknown[] }) => {
      const changes = Array.isArray(payload.changes) ? (payload.changes as EntityChangeDto[]) : [];
      const payloadCursor =
        typeof payload.cursor === 'number'
          ? payload.cursor
          : changes.length > 0
            ? (changes[changes.length - 1]?.seq ?? 0)
            : 0;
      updateCursor(payloadCursor);
      setLastChanges(changes);
      invalidateRealtimeChanges(queryClient, payload.changes);
    };
    const catchUp = async (start = cursorRef.current) => {
      let cursor = start;
      if (cursor <= 0) return;

      while (true) {
        const response = await fetchApi(`/sync/changes?after=${cursor}`);
        if (response.status === 409) {
          const body = await response.json();
          if (
            body.code === 'snapshot_required' &&
            Number.isSafeInteger(body.cursor) &&
            body.cursor >= 0
          ) {
            throw new SnapshotRequired(body.cursor);
          }
        }
        if (!response.ok) throw new Error('Realtime catch-up failed');
        const payload = (await response.json()) as Partial<SyncChangesDto>;
        applyChangePayload(payload);
        cursor = typeof payload.cursor === 'number' ? payload.cursor : cursorRef.current;
        if (!payload.hasMore) return;
      }
    };
    const verifyRefreshedQueries = () => {
      for (const query of queryClient.getQueryCache().findAll({ type: 'active' })) {
        if (query.state.status !== 'error') continue;
        const error = query.state.error;
        // A failed refresh must not continue showing an old record as current.
        // Null is an explicit absence: setting undefined lets a mounted query's
        // initialData repopulate the old value when its options are applied.
        query.setState({ data: null, dataUpdatedAt: 0 });
        if (error instanceof ApiRequestError && (error.status === 403 || error.status === 404)) {
          continue;
        }
        throw error ?? new Error('State refresh failed');
      }
    };
    const recover = async (initialCursor: number) => {
      if (recovering || stopped) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      recovering = true;
      recoveryPending = true;
      setState('reconnecting');
      let cursor = initialCursor;
      try {
        while (!stopped) {
          try {
            // Drop inactive cached entities, then reload all active authorized
            // state before replaying every change since the safe cursor.
            for (const query of queryClient.getQueryCache().findAll({ type: 'inactive' })) {
              if (query.getObserversCount() > 0) {
                // Disabled queries can still have mounted observers. Clearing
                // to null prevents their initialData from resurrecting stale
                // records, and invalidation makes them refetch when enabled.
                query.setState({ data: null, dataUpdatedAt: 0, isInvalidated: true });
              } else {
                queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
              }
            }
            await queryClient.resetQueries({ type: 'active' });
            verifyRefreshedQueries();
            updateCursor(cursor);
            do {
              changedDuringRecovery = false;
              await catchUp(cursor);
              // Replayed invalidations must settle before the link is reported
              // live; failed refreshes retry from the previous safe cursor.
              await queryClient.refetchQueries({ type: 'active', stale: true });
              verifyRefreshedQueries();
              cursor = cursorRef.current;
            } while (changedDuringRecovery && !stopped);
            if (!stopped) {
              recoveryPending = false;
              setState('live');
            }
            return;
          } catch (error) {
            if (error instanceof SnapshotRequired) {
              cursor = error.cursor;
              continue;
            }
            throw error;
          }
        }
      } catch {
        if (!stopped) retryTimer = setTimeout(() => void recover(cursor), 2_000);
      } finally {
        recovering = false;
      }
    };
    const onOpen = () => {
      if (recoveryPending) return;
      const hadCursor = cursorRef.current > 0;
      if (!hadCursor) {
        setState('live');
        return;
      }
      void catchUp()
        .catch(error => {
          if (error instanceof SnapshotRequired) void recover(error.cursor);
          else invalidateAll();
        })
        .finally(() => {
          if (!recoveryPending) setState('live');
        });
    };

    // One SSE code path for every backend mode. `connectEventStream` sends the
    // Authorization header for remote/bearer backends and falls back to
    // `credentials: 'include'` (cookie auth) when no header is present, so the
    // local same-origin case no longer needs a separate native EventSource branch.
    const disconnect = connectEventStream({
      url: () =>
        resolveEventSourceUrl(
          cursorRef.current > 0 ? `/realtime?after=${cursorRef.current}` : '/realtime'
        ),
      headers: getAuthorizationHeader(),
      handlers: {
        onOpen,
        onHello,
        onChange: payload => {
          if (recoveryPending) {
            changedDuringRecovery = true;
            return;
          }
          setState('live');
          applyChangePayload(payload);
        },
        onRefresh: () => {
          if (recoveryPending) {
            changedDuringRecovery = true;
            return;
          }
          setState('live');
          invalidateAll();
        },
        onError: () => setState('reconnecting'),
        onSnapshotRequired: cursor => void recover(cursor)
      }
    });
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      disconnect();
    };
  }, [queryClient]);

  return (
    <RealtimeContext.Provider value={{ state, lastSeq, lastChanges }}>
      {children}
    </RealtimeContext.Provider>
  );
}

class SnapshotRequired extends Error {
  constructor(readonly cursor: number) {
    super('Snapshot required');
  }
}

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext);
}
