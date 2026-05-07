'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { normalizeBoardBootstrap } from '@/lib/client-data/tickets/board-normalize';
import type { BoardScope, BoardStatus } from '@/lib/client-data/tickets/board-types';
import BoardHydrationBoundary from '@/lib/client-data/tickets/BoardHydrationBoundary';
import { defaultBoardFetcher } from '@/lib/client-data/tickets/fetchers';
import { ticketQueryKeys } from '@/lib/client-data/tickets/query-keys';
import type { TicketListFilters } from '@/lib/helpers/ticket-list-filters';

import CalendarView from './CalendarView';
import KanbanBoard from './KanbanBoard';
import type { Ticket } from './KanbanCard';
import TicketListView from './TicketListView';
import { TicketViewContext } from './TicketViewContext';

type TicketsBoardClientProps = {
  initialView: string;
  organizationId?: number;
  projectId?: string;
  showOrganizationName?: boolean;
  tickets: Ticket[];
  statuses: Array<{ name: string; position: number; status_type?: string }>;
  boardScope: BoardScope;
  boardBootstrapStatuses: BoardStatus[];
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
    () => ({
      scope: boardScope,
      tickets: tickets.map(t => ({
        id: t.id,
        title: t.title,
        objective: t.objective ?? null,
        organization_id: t.organization_id,
        project_id: t.project_id,
        project_name: t.project_name,
        project_color: t.project_color,
        project_everhour_project_id: t.project_everhour_project_id,
        everhour_task_id: t.everhour_task_id,
        agent_session_state: t.agent_session_state,
        running_agent: t.running_agent,
        latest_objective_agent: t.latest_objective_agent,
        status: t.status,
        priority: t.priority,
        execution_target: t.execution_target,
        assigned_agent: t.assigned_agent,
        board_position: t.board_position,
        organization_name: t.organization_name,
        waiting_for_response_at: t.waiting_for_response_at,
        is_read: t.is_read,
        objectives_executed_count: t.objectives_executed_count,
        updated_at: t.updated_at,
        schedule_id: t.schedule_id ?? null,
        due_datetime: t.due_datetime
      })),
      statuses: boardBootstrapStatuses
    }),
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
  // board and list use the same server-fetched data; both get 'board' dataset for hydration
  const boardDataset = activeView === 'list' ? 'list' : 'board';

  return (
    <TicketViewContext.Provider value={{ activeView, setActiveView }}>
      <div className="flex flex-1 min-h-0 flex-col gap-4">
        <BoardHydrationBoundary
          scope={boardScope}
          bootstrap={boardBootstrap}
          statuses={boardBootstrapStatuses}
          dataset={boardDataset}
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
            />
          </div>
        ) : showBoard ? (
          <KanbanBoard
            tickets={tickets}
            statuses={statuses}
            showOrganizationName={showOrganizationName}
            organizationId={organizationId}
            projectId={projectId}
            fileMentionPaths={fileMentionPaths}
            workingDirectory={workingDirectory}
            initialView={activeView}
            initialHiddenColumns={initialHiddenColumns}
            scheduledVisibilityDays={scheduledVisibilityDays}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 md:px-6">
            <TicketListView
              tickets={tickets}
              statuses={statuses}
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
