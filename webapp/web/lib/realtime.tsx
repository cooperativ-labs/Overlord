import type { EntityChangeDto, SyncChangesDto } from '@overlord/contract';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';

import { ApiRequestError } from './api/request.ts';
import { getAuthorizationHeader } from './api-base.ts';
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
  const cursorRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let recovering = false;
    let recoveryPending = false;
    let changedDuringRecovery = false;
    let stopped = false;
    let streamReady = false;
    let streamAttempt = 0;
    let requestedCursor: number | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const invalidateAll = () => invalidateNonEverhourQueries(queryClient);
    const updateCursor = (cursor: number) => {
      if (!Number.isSafeInteger(cursor) || cursor <= (cursorRef.current ?? -1)) return;
      cursorRef.current = cursor;
      setLastSeq(cursor);
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
    const catchUp = async (start: number, current = () => !stopped) => {
      let cursor = start;

      while (current()) {
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
        if (!current()) return;
        applyChangePayload(payload);
        cursor = payload.cursor ?? cursor;
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
              cursor = cursorRef.current ?? cursor;
            } while (changedDuringRecovery && !stopped);
            if (!stopped) {
              recoveryPending = false;
              if (streamReady) setState('live');
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
    const markStreamReady = () => {
      streamReady = true;
      if (!recoveryPending) setState('live');
    };
    const onHello = (cursor: number, replayComplete: boolean) => {
      if (replayComplete || requestedCursor === undefined) {
        if (!recoveryPending) updateCursor(cursor);
        else if (cursor > (cursorRef.current ?? -1)) changedDuringRecovery = true;
        markStreamReady();
        return;
      }
      // An older backend sends its greeting before replay and ignores the opt-in.
      if (recoveryPending) {
        markStreamReady();
        return;
      }
      const attempt = streamAttempt;
      const current = () => !stopped && streamAttempt === attempt;
      void catchUp(requestedCursor, () => current() && !recoveryPending)
        .catch(error => {
          if (!current() || recoveryPending) return;
          if (error instanceof SnapshotRequired) void recover(error.cursor);
          else invalidateAll();
        })
        .finally(() => {
          if (current()) markStreamReady();
        });
    };

    // One SSE code path for every backend mode. `connectEventStream` sends the
    // Authorization header for remote/bearer backends and falls back to
    // `credentials: 'include'` (cookie auth) when no header is present, so the
    // local same-origin case no longer needs a separate native EventSource branch.
    const disconnect = connectEventStream({
      url: () => {
        streamAttempt++;
        requestedCursor = cursorRef.current;
        return resolveEventSourceUrl(
          requestedCursor === undefined
            ? '/realtime'
            : `/realtime?after=${requestedCursor}&replayComplete=1`
        );
      },
      headers: getAuthorizationHeader(),
      handlers: {
        onHello,
        onChange: payload => {
          if (recoveryPending) {
            changedDuringRecovery = true;
            return;
          }
          applyChangePayload(payload);
        },
        onRefresh: () => {
          if (recoveryPending) {
            changedDuringRecovery = true;
            return;
          }
          invalidateAll();
        },
        onError: () => {
          streamAttempt++;
          streamReady = false;
          setState('reconnecting');
        },
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
