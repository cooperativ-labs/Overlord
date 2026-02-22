import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

import KanbanBoard from './KanbanBoard';
import TicketListView from './TicketListView';
import TicketsViewToggle from './TicketsViewToggle';

const statusOrder = ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled'];

function sortByStatus<T extends { status: string }>(items: T[]): T[] {
  const statusWeight = new Map(statusOrder.map((status, index) => [status, index]));
  return [...items].sort((left, right) => {
    const leftWeight = statusWeight.get(left.status) ?? 999;
    const rightWeight = statusWeight.get(right.status) ?? 999;
    return leftWeight - rightWeight;
  });
}

function getOrganizationName(
  organization: { name: string } | Array<{ name: string }> | null | undefined
) {
  if (!organization) {
    return null;
  }

  if (Array.isArray(organization)) {
    return organization[0]?.name ?? null;
  }

  return organization.name ?? null;
}

function getRelationItem<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
}

function dedupeStatuses(statuses: Array<{ name: string; position: number }>) {
  const byName = new Map<string, number>();

  for (const status of statuses) {
    const existingPosition = byName.get(status.name);
    if (existingPosition === undefined || status.position < existingPosition) {
      byName.set(status.name, status.position);
    }
  }

  return [...byName.entries()]
    .map(([name, position]) => ({ name, position }))
    .sort((left, right) => left.position - right.position);
}

type TicketsBoardContentProps = {
  view?: string;
  organizationId?: number;
  showOrganizationName?: boolean;
  title?: string;
  description?: string;
  projectId?: string;
};

type RawTicket = {
  id: string;
  title: string | null;
  objective: string | null;
  execution_target: Database['public']['Enums']['ticket_execution_target'];
  status: string;
  priority: string;
  assigned_agent: string | null;
  updated_at: string;
  board_position: number;
  organization_id: number;
  project_id: string | null;
  everhour_task_id: string | null;
  organization: { name: string } | Array<{ name: string }> | null;
  project:
    | { name: string; color: string; everhour_project_id: string | null }
    | Array<{
        name: string;
        color: string;
        everhour_project_id: string | null;
      }>
    | null;
};

type SessionState = Database['public']['Enums']['session_state'];
type AgentSessionForBoard = Pick<
  Database['public']['Tables']['agent_sessions']['Row'],
  'ticket_id' | 'session_state'
>;

export default async function TicketsBoardContent({
  view = 'board',
  organizationId,
  showOrganizationName = false,
  title,
  description,
  projectId
}: TicketsBoardContentProps) {
  const supabase = await createClient();

  let ticketsQuery = supabase
    .from('tickets')
    .select(
      'id,title,objective,execution_target,status,priority,assigned_agent,updated_at,board_position,organization_id,project_id,everhour_task_id,organization:organizations(name),project:projects(name,color,everhour_project_id)'
    )
    .order('board_position', { ascending: true })
    .order('created_at', { ascending: true });

  let statusesQuery = supabase
    .from('ticket_statuses')
    .select('name,position')
    .order('position', { ascending: true });

  if (organizationId !== undefined) {
    ticketsQuery = ticketsQuery.eq('organization_id', organizationId);
    statusesQuery = statusesQuery.eq('organization_id', organizationId);
  }

  if (projectId !== undefined) {
    ticketsQuery = ticketsQuery.eq('project_id', projectId);
  }

  const [ticketsResult, statusesResult] = await Promise.all([ticketsQuery, statusesQuery]);

  const rawTickets = (ticketsResult.data ?? []) as RawTicket[];
  const ticketIds = rawTickets.map(ticket => ticket.id);
  const latestSessionByTicket = new Map<string, SessionState>();

  if (ticketIds.length > 0) {
    const { data: sessions } = await supabase
      .from('agent_sessions')
      .select('ticket_id,session_state')
      .in('ticket_id', ticketIds)
      .order('attached_at', { ascending: false });

    for (const session of (sessions ?? []) as AgentSessionForBoard[]) {
      if (!latestSessionByTicket.has(session.ticket_id)) {
        latestSessionByTicket.set(session.ticket_id, session.session_state);
      }
    }
  }

  const tickets = rawTickets.map(({ organization, project, ...ticket }) => {
    const p = getRelationItem(project);
    return {
      ...ticket,
      organization_name: getOrganizationName(organization),
      project_name: p?.name ?? null,
      project_color: p?.color ?? null,
      project_everhour_project_id: p?.everhour_project_id ?? null,
      agent_session_state: latestSessionByTicket.get(ticket.id) ?? null
    };
  });
  const statuses = dedupeStatuses(statusesResult.data ?? []);
  const loadError = ticketsResult.error ?? statusesResult.error;

  const sorted = sortByStatus(tickets);

  const showBoard = view === 'board' && statuses.length > 0;

  return (
    <div className="flex flex-col gap-4 ">
      <nav className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 p-4 md:p-6">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <TicketsViewToggle />
      </nav>

      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription>Failed to load tickets: {loadError.message}</AlertDescription>
        </Alert>
      ) : null}

      {showBoard ? (
        <KanbanBoard
          tickets={tickets}
          statuses={statuses}
          showOrganizationName={showOrganizationName}
          organizationId={organizationId}
          projectId={projectId}
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <TicketListView tickets={sorted} showOrganizationName={showOrganizationName} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
