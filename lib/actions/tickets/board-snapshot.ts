// Shared server-side loader for the ticket board snapshot.
//
// Both the server component (`TicketsBoardContent`) and the client refetch
// path (`getTicketBoardBootstrapAction`) load board data through this module,
// so the two can never drift: every path returns tickets enriched with the
// same objective aggregates, agent sessions, waiting questions, assignees,
// and Everhour gating.

import type {
  BoardStatus,
  ColumnPageInfo,
  TicketAssignee
} from '@/lib/client-data/tickets/board-types';
import { mergeRowsById } from '@/lib/helpers/scheduled-ticket-visibility';
import { parseObjectiveAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import {
  aggregateObjectivesByTicket,
  indexLatestSessionByTicket,
  indexLatestWaitingByTicket,
  type ObjectiveAggregationRow,
  resolveRunningAgent,
  type SessionAggregationRow,
  type TicketObjectiveAggregate,
  WAITING_TICKET_EVENT_TYPES
} from '@/lib/helpers/ticket-board-aggregation';
import type { Database } from '@/types/database.types';

import type { ServerSupabase } from './internals';

export const TICKET_BOARD_SELECT =
  'id,ticket_id,ticket_sequence,title,due_datetime,for_human,status,priority,is_read,updated_at,board_position,organization_id,project_id,everhour_task_id,schedule_id,delegate,assigned_member,organization:organizations(name),project:projects(name,color,everhour_project_id)';
export const COMPLETE_TICKETS_PAGE_SIZE = 20;
const ALL_TICKETS_PAGE_SIZE = 1000;

export type RawBoardTicket = {
  id: string;
  ticket_id: string | null;
  ticket_sequence: number;
  title: string | null;
  due_datetime: string | null;
  for_human: boolean;
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
  assigned_member: string | null;
  organization: { name: string } | Array<{ name: string }> | null;
  project:
    | { name: string; color: string; everhour_project_id: string | null }
    | Array<{ name: string; color: string; everhour_project_id: string | null }>
    | null;
};

type SessionRow = Pick<
  Database['public']['Tables']['agent_sessions']['Row'],
  'session_state' | 'agent_identifier'
>;

export type BoardSnapshotTicket = ReturnType<typeof mapBoardTicket>;

export type BoardSnapshotScope = {
  organizationId?: number;
  projectId?: string;
};

export type TicketBoardSnapshot = {
  statuses: BoardStatus[];
  statusesError: unknown | null;
  tickets: BoardSnapshotTicket[];
  ticketsError: unknown | null;
  columnPageInfo?: Record<string, ColumnPageInfo>;
};

function getRelationItem<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

/**
 * Collapse duplicate status names across organizations (the user board spans
 * every organization the user belongs to) keeping the lowest position.
 */
export function dedupeBoardStatuses(
  statuses: Array<{ name: string; position: number; status_type?: string }>
): BoardStatus[] {
  const byName = new Map<string, { position: number; status_type?: string }>();

  for (const status of statuses) {
    const existing = byName.get(status.name);
    if (existing === undefined || status.position < existing.position) {
      byName.set(status.name, { position: status.position, status_type: status.status_type });
    }
  }

  return [...byName.entries()]
    .map(([name, { position, status_type }]) => ({ name, position, status_type }))
    .sort((left, right) => left.position - right.position);
}

/**
 * Resolve the assignee display info (name/username/avatar) for a set of tickets.
 *
 * tickets.assigned_member stores a members.id ([orgid]:[username]); the avatar
 * and name live on profiles, which co-members cannot read directly. We go
 * through get_org_member_directory — a SECURITY DEFINER RPC that returns only
 * the safe display columns — once per distinct organization, and build a
 * memberId -> assignee map the card renderers can consume.
 */
async function buildTicketAssigneeMap(
  supabase: ServerSupabase,
  tickets: Pick<RawBoardTicket, 'assigned_member' | 'organization_id'>[]
): Promise<Map<string, TicketAssignee>> {
  const assigneeMap = new Map<string, TicketAssignee>();
  const organizationIds = new Set<number>();
  for (const ticket of tickets) {
    if (ticket.assigned_member) {
      organizationIds.add(ticket.organization_id);
    }
  }
  if (organizationIds.size === 0) {
    return assigneeMap;
  }

  type DirectoryRow =
    Database['public']['Functions']['get_org_member_directory']['Returns'][number];

  const directories = await Promise.all(
    [...organizationIds].map(orgId => supabase.rpc('get_org_member_directory', { org_id: orgId }))
  );

  for (const { data } of directories) {
    for (const row of (data ?? []) as DirectoryRow[]) {
      assigneeMap.set(row.member_id, {
        memberId: row.member_id,
        name: row.name ?? null,
        username: row.username ?? null,
        imageUrl: row.image_url ?? null
      });
    }
  }

  return assigneeMap;
}

async function userHasEverhourApiKey(
  supabase: ServerSupabase,
  userId: string | null
): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabase
    .from('user_integrations')
    .select('api_key')
    .eq('user_id', userId)
    .eq('provider', 'everhour')
    .limit(1)
    .maybeSingle();
  return typeof data?.api_key === 'string' && data.api_key.trim().length > 0;
}

function mapBoardTicket(
  raw: RawBoardTicket,
  enrichment: {
    aggregate?: TicketObjectiveAggregate;
    session?: SessionRow;
    waitingAt?: string;
    assignee?: TicketAssignee | null;
    hasEverhourApiKey: boolean;
  }
) {
  const p = getRelationItem(raw.project);
  const org = getRelationItem(raw.organization);
  const { aggregate, session } = enrichment;
  return {
    id: raw.id,
    ticket_id: raw.ticket_id,
    ticket_sequence: raw.ticket_sequence,
    title: raw.title,
    objective: null,
    due_datetime: raw.due_datetime,
    for_human: raw.for_human,
    status: raw.status,
    priority: raw.priority,
    assigned_agent: parseObjectiveAssignedAgent(
      (aggregate?.latestAssignedAgent ??
        null) as Database['public']['Tables']['objectives']['Row']['assigned_agent']
    ),
    latest_objective_agent: aggregate?.latestObjectiveAgent ?? null,
    is_read: raw.is_read,
    updated_at: raw.updated_at,
    board_position: raw.board_position,
    organization_id: raw.organization_id,
    project_id: raw.project_id,
    everhour_task_id: raw.everhour_task_id,
    schedule_id: raw.schedule_id,
    delegate: raw.delegate,
    assigned_member: raw.assigned_member,
    assignee: enrichment.assignee ?? null,
    organization_name: org?.name ?? null,
    project_name: p?.name ?? (raw.project_id ? null : 'Inbox'),
    project_color: p?.color ?? null,
    project_everhour_project_id:
      enrichment.hasEverhourApiKey && raw.project_id ? (p?.everhour_project_id ?? null) : null,
    agent_session_state: session?.session_state ?? null,
    running_agent: resolveRunningAgent(aggregate, session),
    has_executing_objective: aggregate?.hasExecutingObjective ?? false,
    waiting_for_response_at: enrichment.waitingAt ?? null,
    has_unopened_waiting_response: false,
    objectives_executed_count: aggregate?.executedObjectivesCount ?? 0,
    has_draft_objective_with_text: aggregate?.hasDraftObjectiveWithText ?? false
  };
}

/**
 * Enrich raw ticket rows with objective aggregates, latest agent sessions,
 * waiting questions, assignees, and Everhour gating. Shared by the board
 * bootstrap (SSR + client refetch) and load-more so every path returns the
 * same shape.
 */
export async function enrichBoardTickets(
  supabase: ServerSupabase,
  rawTickets: RawBoardTicket[],
  options: { userId: string | null }
): Promise<BoardSnapshotTicket[]> {
  const ticketIds = rawTickets.map(ticket => ticket.id);

  const [objectivesResult, sessionsResult, waitingResult, assigneeByMemberId, hasEverhourApiKey] =
    await Promise.all([
      ticketIds.length > 0
        ? supabase
            .from('objectives')
            .select('ticket_id,state,objective,agent_identifier,assigned_agent')
            .in('ticket_id', ticketIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      ticketIds.length > 0
        ? supabase
            .from('agent_sessions')
            .select(
              'session_state,agent_identifier,attached_at,objective:objectives!inner(ticket_id)'
            )
            .in('objective.ticket_id', ticketIds)
            .order('attached_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      ticketIds.length > 0
        ? supabase
            .from('ticket_events')
            .select('ticket_id,created_at')
            .in('ticket_id', ticketIds)
            .in('event_type', [...WAITING_TICKET_EVENT_TYPES])
            .eq('is_blocking', true)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      buildTicketAssigneeMap(supabase, rawTickets),
      userHasEverhourApiKey(supabase, options.userId)
    ]);

  if (objectivesResult.error) throw new Error(objectivesResult.error.message);

  const aggregateByTicket = aggregateObjectivesByTicket(
    (objectivesResult.data ?? []) as ObjectiveAggregationRow[]
  );
  const sessionByTicket = indexLatestSessionByTicket(
    (sessionsResult.data ?? []) as Array<
      SessionAggregationRow & {
        objective: { ticket_id: string } | Array<{ ticket_id: string }> | null;
      }
    >
  );
  const waitingByTicket = indexLatestWaitingByTicket(
    (waitingResult.data ?? []) as Array<{ ticket_id: string; created_at: string }>
  );

  return rawTickets.map(ticket =>
    mapBoardTicket(ticket, {
      aggregate: aggregateByTicket.get(ticket.id),
      session: sessionByTicket.get(ticket.id) as SessionRow | undefined,
      waitingAt: waitingByTicket.get(ticket.id),
      assignee: ticket.assigned_member
        ? (assigneeByMemberId.get(ticket.assigned_member) ?? null)
        : null,
      hasEverhourApiKey
    })
  );
}

async function loadBoardTicketsForStatus(
  supabase: ServerSupabase,
  {
    status,
    statusType,
    organizationId,
    projectId,
    window
  }: {
    status: string;
    statusType?: string;
    organizationId?: number;
    projectId?: string;
    window: { startIso: string; endIso: string } | null;
  }
): Promise<{ tickets: RawBoardTicket[]; pageInfo: ColumnPageInfo }> {
  if (statusType !== 'complete') {
    const rows = await loadAllBoardTicketsForStatus(supabase, {
      status,
      organizationId,
      projectId
    });
    return { tickets: rows, pageInfo: { cutoff: null, hasMore: false } };
  }

  let recentQuery = supabase
    .from('tickets')
    .select(TICKET_BOARD_SELECT)
    .eq('status', status)
    .order('board_position', { ascending: true })
    .limit(COMPLETE_TICKETS_PAGE_SIZE);

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

  const recentRows = (recentTickets ?? []) as RawBoardTicket[];
  const pageInfo: ColumnPageInfo = {
    cutoff: recentRows.at(-1)?.updated_at ?? null,
    hasMore: recentRows.length === COMPLETE_TICKETS_PAGE_SIZE
  };

  if (!window) {
    return { tickets: recentRows, pageInfo };
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

  return {
    tickets: mergeRowsById(recentRows, (scheduledTickets ?? []) as RawBoardTicket[]),
    pageInfo
  };
}

async function loadAllBoardTicketsForStatus(
  supabase: ServerSupabase,
  {
    status,
    organizationId,
    projectId
  }: {
    status: string;
    organizationId?: number;
    projectId?: string;
  }
): Promise<RawBoardTicket[]> {
  const rows: RawBoardTicket[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from('tickets')
      .select(TICKET_BOARD_SELECT)
      .eq('status', status)
      .order('board_position', { ascending: true })
      .range(offset, offset + ALL_TICKETS_PAGE_SIZE - 1);

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

    const batch = (data ?? []) as RawBoardTicket[];
    rows.push(...batch);
    if (batch.length < ALL_TICKETS_PAGE_SIZE) {
      return rows;
    }
    offset += ALL_TICKETS_PAGE_SIZE;
  }
}

/**
 * Load the full board snapshot: deduped statuses plus enriched tickets for
 * every column (or the calendar window when `dataset` is 'calendar').
 *
 * Per-status load failures are collected into `ticketsError` rather than
 * thrown, so SSR can render a partial board with an error banner; callers
 * that need all-or-nothing (the refetch action) throw on `ticketsError`.
 */
export async function loadTicketBoardSnapshot(
  supabase: ServerSupabase,
  {
    organizationId,
    projectId,
    dataset = 'board',
    scheduledWindow,
    userId
  }: BoardSnapshotScope & {
    dataset?: 'board' | 'calendar';
    scheduledWindow: { startIso: string; endIso: string } | null;
    userId: string | null;
  }
): Promise<TicketBoardSnapshot> {
  let statusesQuery = supabase
    .from('ticket_statuses')
    .select('name,position,status_type')
    .order('position', { ascending: true });

  if (organizationId !== undefined) {
    statusesQuery = statusesQuery.eq('organization_id', organizationId);
  }

  const statusesResult = await statusesQuery;
  const statuses = dedupeBoardStatuses(statusesResult.data ?? []);

  let rawTickets: RawBoardTicket[];
  let columnPageInfo: Record<string, ColumnPageInfo> | undefined;
  let ticketsError: unknown | null = null;

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
      ticketsError = new Error(error.message);
    }
    rawTickets = (data ?? []) as RawBoardTicket[];
  } else {
    const ticketResults = await Promise.all(
      statuses.map(async status => {
        try {
          const result = await loadBoardTicketsForStatus(supabase, {
            status: status.name,
            statusType: status.status_type,
            organizationId,
            projectId,
            window: scheduledWindow
          });
          return { ...result, error: null };
        } catch (error) {
          return {
            tickets: [] as RawBoardTicket[],
            pageInfo: { cutoff: null, hasMore: false } as ColumnPageInfo,
            error
          };
        }
      })
    );

    ticketsError = ticketResults.find(result => result.error)?.error ?? null;
    rawTickets = ticketResults.flatMap(result => result.tickets);
    columnPageInfo = Object.fromEntries(
      statuses.map((status, index) => [
        status.name,
        ticketResults[index]?.pageInfo ?? { cutoff: null, hasMore: false }
      ])
    );
  }

  const tickets = await enrichBoardTickets(supabase, rawTickets, { userId });

  return {
    statuses,
    statusesError: statusesResult.error ?? null,
    tickets,
    ticketsError,
    columnPageInfo
  };
}
