'use server';

import { getScheduledTicketVisibilityDaysForUser } from '@/lib/actions/scheduled-ticket-visibility-preference';
import type {
  BoardBootstrap,
  BoardDataset,
  BoardScope,
  BoardStatus
} from '@/lib/client-data/tickets/board-types';
import {
  getScheduledTicketVisibilityWindow,
  mergeRowsById
} from '@/lib/helpers/scheduled-ticket-visibility';
import { parseObjectiveAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { createClientForRequest } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

import type { ServerSupabase } from './internals';

const TICKET_BOARD_SELECT =
  'id,title,due_datetime,execution_target,status,priority,is_read,updated_at,board_position,organization_id,project_id,everhour_task_id,schedule_id,delegate,organization:organizations(name),project:projects(name,color,everhour_project_id)';

type RawBoardTicket = {
  id: string;
  title: string | null;
  due_datetime: string | null;
  execution_target: Database['public']['Enums']['ticket_execution_target'];
  status: string;
  priority: string;
  is_read: boolean;
  updated_at: string;
  board_position: number;
  organization_id: number;
  project_id: string | null;
  everhour_task_id: string | null;
  schedule_id: number | null;
  delegate: string | null;
  organization: { name: string } | Array<{ name: string }> | null;
  project:
    | { name: string; color: string; everhour_project_id: string | null }
    | Array<{ name: string; color: string; everhour_project_id: string | null }>
    | null;
};

function mapBoardTicket(
  raw: RawBoardTicket,
  latestObjectiveAgent: string | null = null,
  latestObjectiveAssignedAgent: Database['public']['Tables']['objectives']['Row']['assigned_agent'] = null,
  hasExecutingObjective = false
) {
  const p = Array.isArray(raw.project) ? raw.project[0] : raw.project;
  const org = Array.isArray(raw.organization) ? raw.organization[0] : raw.organization;
  return {
    id: raw.id,
    title: raw.title,
    objective: null,
    due_datetime: raw.due_datetime,
    execution_target: raw.execution_target,
    status: raw.status,
    priority: raw.priority,
    assigned_agent: parseObjectiveAssignedAgent(latestObjectiveAssignedAgent),
    latest_objective_agent: latestObjectiveAgent,
    is_read: raw.is_read,
    updated_at: raw.updated_at,
    board_position: raw.board_position,
    organization_id: raw.organization_id,
    project_id: raw.project_id,
    everhour_task_id: raw.everhour_task_id,
    schedule_id: raw.schedule_id,
    delegate: raw.delegate,
    organization_name: org?.name ?? null,
    project_name: p?.name ?? (raw.project_id ? null : 'Inbox'),
    project_color: p?.color ?? null,
    project_everhour_project_id: p?.everhour_project_id ?? null,
    agent_session_state: null,
    running_agent: null,
    has_executing_objective: hasExecutingObjective,
    waiting_for_response_at: null as string | null,
    has_unopened_waiting_response: false,
    objectives_executed_count: 0
  };
}

async function loadBoardTicketsForStatus(
  supabase: ServerSupabase,
  {
    status,
    organizationId,
    projectId,
    window
  }: {
    status: string;
    organizationId?: number;
    projectId?: string;
    window: { startIso: string; endIso: string } | null;
  }
): Promise<{
  tickets: RawBoardTicket[];
  pageInfo: { cutoff: string | null; hasMore: boolean };
}> {
  let recentQuery = supabase
    .from('tickets')
    .select(TICKET_BOARD_SELECT)
    .eq('status', status)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (organizationId !== undefined) {
    recentQuery = recentQuery.eq('organization_id', organizationId);
  }
  if (projectId !== undefined) {
    recentQuery = recentQuery.eq('project_id', projectId);
  }

  const { data: recentTickets, error: recentError } = await recentQuery;
  if (recentError) {
    throw new Error(recentError.message);
  }

  if (!window) {
    const rows = (recentTickets ?? []) as RawBoardTicket[];
    return {
      tickets: rows,
      pageInfo: {
        cutoff: rows.at(-1)?.updated_at ?? null,
        hasMore: rows.length === 20
      }
    };
  }

  let scheduledQuery = supabase
    .from('tickets')
    .select(TICKET_BOARD_SELECT)
    .eq('status', status)
    .not('schedule_id', 'is', null)
    .gte('due_datetime', window.startIso)
    .lte('due_datetime', window.endIso)
    .order('due_datetime', { ascending: true })
    .limit(100);

  if (organizationId !== undefined) {
    scheduledQuery = scheduledQuery.eq('organization_id', organizationId);
  }
  if (projectId !== undefined) {
    scheduledQuery = scheduledQuery.eq('project_id', projectId);
  }

  const { data: scheduledTickets, error: scheduledError } = await scheduledQuery;
  if (scheduledError) {
    throw new Error(scheduledError.message);
  }

  const recentRows = (recentTickets ?? []) as RawBoardTicket[];
  const scheduledRows = (scheduledTickets ?? []) as RawBoardTicket[];
  return {
    tickets: mergeRowsById(recentRows, scheduledRows),
    pageInfo: {
      cutoff: recentRows.at(-1)?.updated_at ?? null,
      hasMore: recentRows.length === 20
    }
  };
}

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
  const statuses = await getTicketStatusesAction(organizationId);
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const scheduledVisibilityDays = user
    ? await getScheduledTicketVisibilityDaysForUser(supabase, user.id)
    : 0;
  const scheduledWindow =
    dataset === 'calendar' ? null : getScheduledTicketVisibilityWindow(scheduledVisibilityDays);

  let rawTickets: RawBoardTicket[];
  let columnPageInfo: Record<string, { cutoff: string | null; hasMore: boolean }> | undefined;

  if (dataset === 'calendar') {
    let query = supabase
      .from('tickets')
      .select(TICKET_BOARD_SELECT)
      .not('due_datetime', 'is', null)
      .order('due_datetime', { ascending: true })
      .limit(500);

    if (organizationId !== undefined) {
      query = query.eq('organization_id', organizationId);
    }
    if (projectId !== undefined) {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    rawTickets = (data ?? []) as RawBoardTicket[];
  } else {
    const ticketResults = await Promise.all(
      statuses.map(status =>
        loadBoardTicketsForStatus(supabase, {
          status: status.name,
          organizationId,
          projectId,
          window: scheduledWindow
        })
      )
    );

    rawTickets = ticketResults.flatMap(result => result.tickets);
    columnPageInfo = Object.fromEntries(
      statuses.map((status, index) => [
        status.name,
        ticketResults[index]?.pageInfo ?? { cutoff: null, hasMore: false }
      ])
    );
  }
  const ticketIds = rawTickets.map(ticket => ticket.id);
  const latestObjectiveAgentByTicket = new Map<string, string | null>();
  const latestObjectiveAssignedAgentByTicket = new Map<
    string,
    Database['public']['Tables']['objectives']['Row']['assigned_agent']
  >();
  const executingObjectiveByTicket = new Set<string>();

  if (ticketIds.length > 0) {
    const { data: objectives, error: objectivesError } = await supabase
      .from('objectives')
      .select('ticket_id,agent_identifier,assigned_agent,state')
      .in('ticket_id', ticketIds)
      .order('created_at', { ascending: false });

    if (objectivesError) throw new Error(objectivesError.message);

    for (const objective of (objectives ?? []) as Array<{
      ticket_id: string;
      agent_identifier: string | null;
      assigned_agent: Database['public']['Tables']['objectives']['Row']['assigned_agent'];
      state: string | null;
    }>) {
      if (!latestObjectiveAgentByTicket.has(objective.ticket_id)) {
        latestObjectiveAgentByTicket.set(objective.ticket_id, objective.agent_identifier ?? null);
      }
      if (!latestObjectiveAssignedAgentByTicket.has(objective.ticket_id)) {
        latestObjectiveAssignedAgentByTicket.set(objective.ticket_id, objective.assigned_agent);
      }
      if (objective.state === 'executing') {
        executingObjectiveByTicket.add(objective.ticket_id);
      }
    }
  }

  return {
    scope,
    statuses,
    tickets: rawTickets.map(ticket =>
      mapBoardTicket(
        ticket,
        latestObjectiveAgentByTicket.get(ticket.id) ?? null,
        latestObjectiveAssignedAgentByTicket.get(ticket.id) ?? null,
        executingObjectiveByTicket.has(ticket.id)
      )
    ),
    columnPageInfo
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
}): Promise<{ tickets: ReturnType<typeof mapBoardTicket>[] }> {
  const supabase = await createClientForRequest();

  let query = supabase
    .from('tickets')
    .select(TICKET_BOARD_SELECT)
    .eq('status', status)
    .lt('updated_at', beforeDate)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (organizationId !== undefined) {
    query = query.eq('organization_id', organizationId);
  }
  if (projectId !== undefined) {
    query = query.eq('project_id', projectId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const tickets = (data ?? []) as RawBoardTicket[];
  const ticketIds = tickets.map(ticket => ticket.id);
  const latestObjectiveAgentByTicket = new Map<string, string | null>();
  const latestObjectiveAssignedAgentByTicket = new Map<
    string,
    Database['public']['Tables']['objectives']['Row']['assigned_agent']
  >();
  const executingObjectiveByTicket = new Set<string>();
  const waitingLatestByTicket = new Map<string, string>();

  if (ticketIds.length > 0) {
    const [
      { data: objectives, error: objectivesError },
      { data: waitingQuestions, error: waitingQuestionsError }
    ] = await Promise.all([
      supabase
        .from('objectives')
        .select('ticket_id,agent_identifier,assigned_agent,state')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('ticket_events')
        .select('ticket_id,created_at')
        .in('ticket_id', ticketIds)
        .eq('event_type', 'question')
        .eq('is_blocking', true)
        .order('created_at', { ascending: false })
    ]);

    if (objectivesError) throw new Error(objectivesError.message);
    if (waitingQuestionsError) throw new Error(waitingQuestionsError.message);

    for (const objective of (objectives ?? []) as Array<{
      ticket_id: string;
      agent_identifier: string | null;
      assigned_agent: Database['public']['Tables']['objectives']['Row']['assigned_agent'];
      state: string | null;
    }>) {
      if (!latestObjectiveAgentByTicket.has(objective.ticket_id)) {
        latestObjectiveAgentByTicket.set(objective.ticket_id, objective.agent_identifier ?? null);
      }
      if (!latestObjectiveAssignedAgentByTicket.has(objective.ticket_id)) {
        latestObjectiveAssignedAgentByTicket.set(objective.ticket_id, objective.assigned_agent);
      }
      if (objective.state === 'executing') {
        executingObjectiveByTicket.add(objective.ticket_id);
      }
    }

    for (const question of (waitingQuestions ?? []) as Array<{
      ticket_id: string;
      created_at: string;
    }>) {
      if (!waitingLatestByTicket.has(question.ticket_id)) {
        waitingLatestByTicket.set(question.ticket_id, question.created_at);
      }
    }
  }

  return {
    tickets: tickets.map(ticket => {
      const mapped = mapBoardTicket(
        ticket,
        latestObjectiveAgentByTicket.get(ticket.id) ?? null,
        latestObjectiveAssignedAgentByTicket.get(ticket.id) ?? null,
        executingObjectiveByTicket.has(ticket.id)
      );
      const waitingAt = waitingLatestByTicket.get(ticket.id);
      return waitingAt ? { ...mapped, waiting_for_response_at: waitingAt } : mapped;
    })
  };
}
