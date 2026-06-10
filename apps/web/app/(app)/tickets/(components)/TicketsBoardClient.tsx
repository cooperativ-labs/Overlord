'use client';

import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { normalizeBoardBootstrap } from '@/lib/client-data/tickets/board-normalize';
import type {
  BoardScope,
  BoardStatus,
  ColumnPageInfo
} from '@/lib/client-data/tickets/board-types';
import BoardHydrationBoundary from '@/lib/client-data/tickets/BoardHydrationBoundary';
import { defaultBoardFetcher } from '@/lib/client-data/tickets/fetchers';
import { ticketQueryKeys } from '@/lib/client-data/tickets/query-keys';
import type { TicketListFilters } from '@/lib/helpers/ticket-list-filters';
import type { Ticket } from '@/types/tickets';

import { buildBoardBootstrap } from './ticket-view-helpers';
import { TicketViewContext } from './TicketViewContext';

const CalendarView = dynamic(() => import('./CalendarView'), { ssr: false });
const KanbanBoard = dynamic(() => import('./KanbanBoard'), { ssr: false });
const TicketListView = dynamic(() => import('./TicketListView'), { ssr: false });

type TicketsBoardClientProps = {
  initialView: string;
  organizationId?: number;
  projectId?: string;
  showOrganizationName?: boolean;
  tickets: Ticket[];
  statuses: Array<{ name: string; position: number; status_type?: string }>;
  boardScope: BoardScope;
  boardBootstrapStatuses: BoardStatus[];
  columnPageInfo?: Record<string, ColumnPageInfo>;
  loadError: { message: string } | null;
  fileMentionPaths?: string[];
  workingDirectory?: string | null;
  initialHiddenColumns?: string[];
  initialListFilters?: TicketListFilters | null;
  initialCollapsedStatuses?: string[];
  initialStatusOrder?: string[];
  scheduledVisibilityDays: number;
  ticketUrlBase: string;
  completeStatusName?: string;
};

export default function TicketsBoardClient({
  initialView,
  organizationId,
  projectId,
  showOrganizationName = false,
  tickets,
  statuses,
  boardScope,
  boardBootstrapStatuses,
  columnPageInfo,
  loadError,
  fileMentionPaths = [],
  workingDirectory = null,
  initialHiddenColumns = [],
  initialListFilters,
  initialCollapsedStatuses,
  initialStatusOrder,
  scheduledVisibilityDays,
  ticketUrlBase,
  completeStatusName
}: TicketsBoardClientProps) {
  const [activeView, setActiveView] = useState(initialView);
  const queryClient = useQueryClient();

  const boardBootstrap = useMemo(
    () =>
      buildBoardBootstrap({
        scope: boardScope,
        tickets,
        statuses: boardBootstrapStatuses,
        columnPageInfo
      }),
    // Capture the server-rendered snapshot once; later updates flow through
    // the TanStack Query cache, not through re-rendered props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Prefetch calendar data in the background so the first switch to calendar
  // is materially faster. Fires once on mount and does not block rendering.
  useEffect(() => {
    if (activeView !== 'calendar') {
      queryClient.prefetchQuery({
        queryKey: ticketQueryKeys.board(boardScope, 'calendar'),
        queryFn: () => defaultBoardFetcher(boardScope, 'calendar').then(normalizeBoardBootstrap),
        staleTime: 30_000
      });
    }
    // Only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showBoard = activeView === 'board' && statuses.length > 0;
  const showCalendar = activeView === 'calendar';

  return (
    <TicketViewContext.Provider value={{ activeView, setActiveView }}>
      <div className="flex flex-1 min-h-0 flex-col gap-4">
        {/* Board and list views share the same 'board' cache entry so realtime
            updates and view switches always read one consistent dataset. */}
        <BoardHydrationBoundary
          scope={boardScope}
          bootstrap={boardBootstrap}
          statuses={boardBootstrapStatuses}
          dataset="board"
          organizationId={organizationId}
        />
        {loadError ? (
          <Alert variant="destructive" className="mx-4 md:mx-6">
            <AlertDescription>Failed to load tickets: {loadError.message}</AlertDescription>
          </Alert>
        ) : null}

        {showCalendar ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 md:px-6">
            <CalendarView
              tickets={tickets}
              statuses={statuses}
              completeStatusName={completeStatusName}
              initialView={activeView}
              showViewToggle
              projectId={projectId}
              organizationId={organizationId}
              ticketUrlBase={ticketUrlBase}
              initialListFilters={initialListFilters}
            />
          </div>
        ) : showBoard ? (
          <KanbanBoard
            tickets={tickets}
            statuses={statuses}
            columnPageInfo={columnPageInfo}
            showOrganizationName={showOrganizationName}
            organizationId={organizationId}
            projectId={projectId}
            fileMentionPaths={fileMentionPaths}
            workingDirectory={workingDirectory}
            initialView={activeView}
            initialHiddenColumns={initialHiddenColumns}
            initialListFilters={initialListFilters}
            scheduledVisibilityDays={scheduledVisibilityDays}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 md:px-6">
            <TicketListView
              tickets={tickets}
              statuses={statuses}
              columnPageInfo={columnPageInfo}
              showOrganizationName={showOrganizationName}
              ticketUrlBase={ticketUrlBase}
              initialView={activeView}
              showViewToggle
              organizationId={organizationId}
              projectId={projectId}
              initialListFilters={initialListFilters}
              initialCollapsedStatuses={initialCollapsedStatuses}
              initialStatusOrder={initialStatusOrder}
              scheduledVisibilityDays={scheduledVisibilityDays}
            />
          </div>
        )}
      </div>
    </TicketViewContext.Provider>
  );
}
