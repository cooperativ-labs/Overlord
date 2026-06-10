'use server';

import { getScheduledTicketVisibilityDaysForUser } from '@/lib/actions/scheduled-ticket-visibility-preference';
import type {
  BoardBootstrap,
  BoardDataset,
  BoardScope,
  BoardStatus
} from '@/lib/client-data/tickets/board-types';
import { getScheduledTicketVisibilityWindow } from '@/lib/helpers/scheduled-ticket-visibility';
import { createClientForRequest } from '@/supabase/utils/server';

import {
  type BoardSnapshotTicket,
  COMPLETE_TICKETS_PAGE_SIZE,
  enrichBoardTickets,
  loadTicketBoardSnapshot,
  type RawBoardTicket,
  TICKET_BOARD_SELECT
} from './board-snapshot';

export async function getTicketStatusesAction(organizationId?: number): Promise<BoardStatus[]> {
  const supabase = await createClientForRequest();
  let query = supabase
    .from('ticket_statuses')
    .select('name,position,status_type')
    .order('position', { ascending: true });

  if (organizationId !== undefined) {
    query = query.eq('organization_id', organizationId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map(status => ({
    name: status.name,
    position: status.position,
    status_type: status.status_type
  }));
}

export async function getTicketBoardBootstrapAction(
  scope: BoardScope,
  dataset: BoardDataset = 'board'
): Promise<BoardBootstrap> {
  const supabase = await createClientForRequest();
  const organizationId = scope.organizationId;
  const projectId = scope.kind === 'project' ? scope.projectId : undefined;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const scheduledVisibilityDays = user
    ? await getScheduledTicketVisibilityDaysForUser(supabase, user.id)
    : 0;
  const scheduledWindow =
    dataset === 'calendar' ? null : getScheduledTicketVisibilityWindow(scheduledVisibilityDays);

  const snapshot = await loadTicketBoardSnapshot(supabase, {
    organizationId,
    projectId,
    dataset: dataset === 'calendar' ? 'calendar' : 'board',
    scheduledWindow,
    userId: user?.id ?? null
  });

  // Background refetches replace the cached board state wholesale, so partial
  // data must fail loudly instead of silently dropping columns.
  if (snapshot.statusesError) {
    throw new Error('Failed to load ticket statuses');
  }
  if (snapshot.ticketsError) {
    throw snapshot.ticketsError instanceof Error
      ? snapshot.ticketsError
      : new Error('Failed to load tickets');
  }

  return {
    scope,
    statuses: snapshot.statuses,
    tickets: snapshot.tickets,
    columnPageInfo: snapshot.columnPageInfo
  };
}

export async function loadMoreTicketsAction({
  status,
  organizationId,
  projectId,
  beforeDate
}: {
  status: string;
  organizationId?: number;
  projectId?: string;
  beforeDate: string;
}): Promise<{ tickets: BoardSnapshotTicket[] }> {
  const supabase = await createClientForRequest();

  let query = supabase
    .from('tickets')
    .select(TICKET_BOARD_SELECT)
    .eq('status', status)
    .lt('updated_at', beforeDate)
    .order('updated_at', { ascending: false })
    .limit(COMPLETE_TICKETS_PAGE_SIZE);

  if (organizationId !== undefined) {
    query = query.eq('organization_id', organizationId);
  }
  if (projectId !== undefined) {
    query = query.eq('project_id', projectId);
  }

  const [{ data, error }, userResult] = await Promise.all([query, supabase.auth.getUser()]);
  if (error) throw new Error(error.message);

  const tickets = await enrichBoardTickets(supabase, (data ?? []) as RawBoardTicket[], {
    userId: userResult.data.user?.id ?? null
  });

  return { tickets };
}
