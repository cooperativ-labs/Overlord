'use client';

import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { loadMoreTicketsAction } from '@/lib/actions/tickets';
import type { ColumnPageInfo } from '@/lib/client-data/tickets/board-types';
import { mergeTicketsIntoBoards } from '@/lib/client-data/tickets/cache';
import type { Ticket } from '@/types/tickets';

import { toBoardTicket } from './ticket-view-helpers';

export const TICKETS_PAGE_SIZE = 20;

type LoadMoreState = { cutoff: string; hasMore: boolean; isLoading: boolean };

/**
 * Shared "load more" pagination for complete columns, used by the Kanban
 * board and the list view so both page through identical state.
 *
 * `hasMore` resolution order: in-session pagination state, then the
 * server-provided column page info, then a count heuristic over the
 * server-rendered tickets (a full first page implies more may exist).
 */
export function useLoadMoreTickets({
  organizationId,
  projectId,
  queryClient,
  mergeWaitingFromLoadedTickets,
  columnPageInfo,
  initialTickets
}: {
  organizationId?: number;
  projectId?: string;
  queryClient: QueryClient;
  mergeWaitingFromLoadedTickets: (tickets: Ticket[]) => void;
  columnPageInfo?: Record<string, ColumnPageInfo>;
  initialTickets: Ticket[];
}) {
  const [loadMoreStates, setLoadMoreStates] = useState<Map<string, LoadMoreState>>(() => new Map());

  const initialCountByColumn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ticket of initialTickets) {
      counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1);
    }
    return counts;
  }, [initialTickets]);

  const columnHasMore = useCallback(
    (columnId: string) => {
      const state = loadMoreStates.get(columnId);
      if (state) return state.hasMore;
      const fromServer = columnPageInfo?.[columnId]?.hasMore;
      if (fromServer !== undefined) return fromServer;
      return (initialCountByColumn.get(columnId) ?? 0) >= TICKETS_PAGE_SIZE;
    },
    [columnPageInfo, initialCountByColumn, loadMoreStates]
  );

  const isColumnLoadingMore = useCallback(
    (columnId: string) => loadMoreStates.get(columnId)?.isLoading ?? false,
    [loadMoreStates]
  );

  const loadMoreForColumn = useCallback(
    async (columnId: string, columnTickets: Ticket[]) => {
      const state = loadMoreStates.get(columnId);
      if (state?.isLoading || state?.hasMore === false) return;

      // Derive the initial cursor from the server page info when available,
      // otherwise from the oldest updated_at currently in the column.
      const columnOldestUpdatedAt =
        columnTickets
          .map(ticket => ticket.updated_at)
          .filter(Boolean)
          .sort()[0] ?? new Date().toISOString();
      const cutoff = state?.cutoff ?? columnPageInfo?.[columnId]?.cutoff ?? columnOldestUpdatedAt;

      setLoadMoreStates(prev => {
        const next = new Map(prev);
        next.set(columnId, { cutoff, hasMore: true, isLoading: true });
        return next;
      });

      try {
        const { tickets: loaded } = await loadMoreTicketsAction({
          status: columnId,
          organizationId,
          projectId,
          beforeDate: cutoff
        });

        // Next cursor is the oldest updated_at in this batch.
        const newCutoff =
          loaded.length > 0 ? (loaded[loaded.length - 1].updated_at ?? cutoff) : cutoff;

        mergeTicketsIntoBoards(queryClient, (loaded as Ticket[]).map(toBoardTicket), 'server-poll');
        mergeWaitingFromLoadedTickets(loaded as Ticket[]);
        setLoadMoreStates(prev => {
          const next = new Map(prev);
          next.set(columnId, {
            cutoff: newCutoff,
            hasMore: loaded.length === TICKETS_PAGE_SIZE,
            isLoading: false
          });
          return next;
        });
      } catch {
        setLoadMoreStates(prev => {
          const next = new Map(prev);
          next.set(columnId, { cutoff, hasMore: true, isLoading: false });
          return next;
        });
      }
    },
    [
      columnPageInfo,
      loadMoreStates,
      mergeWaitingFromLoadedTickets,
      organizationId,
      projectId,
      queryClient
    ]
  );

  return { loadMoreForColumn, columnHasMore, isColumnLoadingMore };
}
