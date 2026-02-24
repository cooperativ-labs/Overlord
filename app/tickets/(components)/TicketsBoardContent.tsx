import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { getViewPreference } from '@/lib/actions/view-preference';
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
  project_id: string;
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
  'ticket_id' | 'session_state' | 'agent_identifier'
>;
type WaitingQuestionForBoard = Pick<
  Database['public']['Tables']['ticket_events']['Row'],
  'ticket_id' | 'created_at'
>;
type ReviewStatusChangeForBoard = Pick<
  Database['public']['Tables']['ticket_events']['Row'],
  'ticket_id' | 'created_at'
>;

export default async function TicketsBoardContent({
  organizationId,
  showOrganizationName = false,
  title,
  description,
  projectId
}: TicketsBoardContentProps) {
  const view = await getViewPreference();
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

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

  const [ticketsResult, statusesResult, everhourIntegrationResult] = await Promise.all([
    ticketsQuery,
    statusesQuery,
    supabase
      .from('user_integrations')
      .select('api_key')
      .eq('user_id', user?.id ?? '')
      .eq('provider', 'everhour')
      .limit(1)
      .maybeSingle()
  ]);

  const everhourApiKey =
    typeof everhourIntegrationResult.data?.api_key === 'string'
      ? everhourIntegrationResult.data.api_key.trim()
      : '';
  const hasEverhourApiKey = everhourApiKey.length > 0;

  const rawTickets = (ticketsResult.data ?? []) as RawTicket[];
  const ticketIds = rawTickets.map(ticket => ticket.id);
  const latestSessionByTicket = new Map<
    string,
    { session_state: SessionState; agent_identifier: string }
  >();
  const waitingQuestionByTicket = new Map<string, string>();
  const reviewStatusByTicket = new Map<string, string>();

  if (ticketIds.length > 0) {
    const [{ data: sessions }, { data: waitingQuestions }, { data: reviewStatusChanges }] =
      await Promise.all([
        supabase
          .from('agent_sessions')
          .select('ticket_id,session_state,agent_identifier')
          .in('ticket_id', ticketIds)
          .order('attached_at', { ascending: false }),
        supabase
          .from('ticket_events')
          .select('ticket_id,created_at')
          .in('ticket_id', ticketIds)
          .eq('event_type', 'question')
          .eq('is_blocking', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('ticket_events')
          .select('ticket_id,created_at')
          .in('ticket_id', ticketIds)
          .eq('event_type', 'status_change')
          .eq('phase', 'review')
          .order('created_at', { ascending: false })
      ]);

    for (const session of (sessions ?? []) as AgentSessionForBoard[]) {
      if (!latestSessionByTicket.has(session.ticket_id)) {
        latestSessionByTicket.set(session.ticket_id, {
          session_state: session.session_state,
          agent_identifier: session.agent_identifier
        });
      }
    }

    for (const waitingQuestion of (waitingQuestions ?? []) as WaitingQuestionForBoard[]) {
      if (!waitingQuestionByTicket.has(waitingQuestion.ticket_id)) {
        waitingQuestionByTicket.set(waitingQuestion.ticket_id, waitingQuestion.created_at);
      }
    }

    for (const reviewStatusChange of (reviewStatusChanges ?? []) as ReviewStatusChangeForBoard[]) {
      if (!reviewStatusByTicket.has(reviewStatusChange.ticket_id)) {
        reviewStatusByTicket.set(reviewStatusChange.ticket_id, reviewStatusChange.created_at);
      }
    }
  }

  const tickets = rawTickets
    .filter(ticket => Boolean(ticket.project_id))
    .map(({ organization, project, ...ticket }) => {
      const p = getRelationItem(project);
      const session = latestSessionByTicket.get(ticket.id);
      const isAttached = session?.session_state === 'attached';
      return {
        ...ticket,
        project_id: ticket.project_id,
        organization_name: getOrganizationName(organization),
        project_name: p?.name ?? null,
        project_color: p?.color ?? null,
        project_everhour_project_id: hasEverhourApiKey ? (p?.everhour_project_id ?? null) : null,
        agent_session_state: session?.session_state ?? null,
        running_agent: isAttached ? session.agent_identifier : null,
        waiting_for_response_at: waitingQuestionByTicket.get(ticket.id) ?? null,
        review_entered_at: reviewStatusByTicket.get(ticket.id) ?? null
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
        <TicketsViewToggle initialView={view} />
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
