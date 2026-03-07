import { headers } from 'next/headers';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { getRawViewPreference } from '@/lib/actions/view-preference';
import { listProjectFiles, resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

import KanbanBoard from './KanbanBoard';
import TicketListView from './TicketListView';

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

function dedupeStatuses(
  statuses: Array<{ name: string; position: number; status_type?: string }>
): Array<{ name: string; position: number; status_type?: string }> {
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

type TicketsBoardContentProps = {
  organizationId?: number;
  showOrganizationName?: boolean;
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
  recent_agent: string | null;
  updated_at: string;
  board_position: number;
  organization_id: number;
  project_id: string;
  everhour_task_id: string | null;
  objectives_executed_count?: number;
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
  projectId
}: TicketsBoardContentProps) {
  const savedView = await getRawViewPreference();
  const headerStore = await headers();
  const ua = headerStore.get('user-agent') ?? '';
  const isMobile = /mobile|android|iphone|ipad/i.test(ua);
  const view = isMobile ? 'list' : (savedView ?? 'board');
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  let ticketsQuery = supabase
    .from('tickets')
    .select(
      'id,title,objective,execution_target,status,priority,assigned_agent,recent_agent,updated_at,board_position,organization_id,project_id,everhour_task_id,organization:organizations(name),project:projects(name,color,everhour_project_id)'
    )
    .order('board_position', { ascending: true })
    .order('created_at', { ascending: true });

  let statusesQuery = supabase
    .from('ticket_statuses')
    .select('name,position,status_type')
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
  const executedObjectivesCountByTicket = new Map<string, number>();

  if (ticketIds.length > 0) {
    const [
      { data: sessions },
      { data: waitingQuestions },
      { data: reviewStatusChanges },
      { data: executedObjectives }
    ] = await Promise.all([
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
        .order('created_at', { ascending: false }),
      supabase
        .from('ticket_objectives')
        .select('ticket_id')
        .in('ticket_id', ticketIds)
        .eq('is_executed', true)
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

    for (const objective of (executedObjectives ?? []) as Array<{ ticket_id: string }>) {
      executedObjectivesCountByTicket.set(
        objective.ticket_id,
        (executedObjectivesCountByTicket.get(objective.ticket_id) ?? 0) + 1
      );
    }
  }

  const tickets = rawTickets
    .filter(ticket => {
      if (!ticket.project_id) {
        console.warn('[TicketsBoardContent] Dropping ticket without project_id:', ticket.id);
        return false;
      }
      return true;
    })
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
        review_entered_at: reviewStatusByTicket.get(ticket.id) ?? null,
        objectives_executed_count: executedObjectivesCountByTicket.get(ticket.id) ?? 0
      };
    });
  const statuses = dedupeStatuses(statusesResult.data ?? []);
  const loadError = ticketsResult.error ?? statusesResult.error;
  let objectiveFileMentionPaths: string[] = [];

  if (projectId && view === 'board') {
    const { data: projectForMentions } = await supabase
      .from('projects')
      .select('local_working_directory')
      .eq('id', projectId)
      .limit(1)
      .maybeSingle();
    const resolvedProjectDirectory = resolveLinkedDirectory(
      projectForMentions?.local_working_directory
    );
    if (resolvedProjectDirectory) {
      try {
        const result = await Promise.race([
          listProjectFiles(resolvedProjectDirectory),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('File listing timed out')), 3000)
          )
        ]);
        objectiveFileMentionPaths = result.files;
      } catch {
        // Non-fatal: file mentions will be unavailable
      }
    }
  }

  const showBoard = view === 'board' && statuses.length > 0;

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      {loadError ? (
        <Alert variant="destructive" className="mx-4 md:mx-6">
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
          fileMentionPaths={objectiveFileMentionPaths}
          initialView={view}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 md:px-6">
          <TicketListView
            tickets={tickets}
            showOrganizationName={showOrganizationName}
            ticketUrlBase={projectId ? `/projects/${projectId}` : '/u'}
            initialView={view}
            showViewToggle={!isMobile}
          />
        </div>
      )}
    </div>
  );
}
