import { headers } from 'next/headers';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { getProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { getRawViewPreference } from '@/lib/actions/view-preference';
import { listProjectFiles, resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { parseTicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

import CalendarView from './CalendarView';
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
  mentionProjectId?: string;
};

type RawTicket = {
  id: string;
  title: string | null;
  objective?: string | null;
  due_datetime: string | null;
  execution_target: Database['public']['Enums']['ticket_execution_target'];
  status: string;
  priority: string;
  assigned_agent: Database['public']['Tables']['tickets']['Row']['assigned_agent'];
  recent_agent: string | null;
  is_read: boolean;
  updated_at: string;
  board_position: number;
  organization_id: number;
  project_id: string;
  everhour_task_id: string | null;
  schedule_id: number | null;
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
const INITIAL_TICKETS_PER_STATUS = 20;

export default async function TicketsBoardContent({
  organizationId,
  showOrganizationName = false,
  projectId,
  mentionProjectId
}: TicketsBoardContentProps) {
  const savedView = await getRawViewPreference();
  const headerStore = await headers();
  const ua = headerStore.get('user-agent') ?? '';
  const isMobile = /mobile|android|iphone/i.test(ua);
  const isElectronRequest = /electron/i.test(ua);

  const projectPreferences = projectId ? await getProjectUserPreferencesAction(projectId) : null;

  const preferredView = projectPreferences?.preferred_view ?? savedView;
  const view = isMobile ? 'list' : (preferredView ?? 'board');
  const initialHiddenColumns = projectPreferences?.hidden_columns ?? [];
  const initialListFilters = projectPreferences?.list_filters ?? null;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  let statusesQuery = supabase
    .from('ticket_statuses')
    .select('name,position,status_type')
    .order('position', { ascending: true });

  if (organizationId !== undefined) {
    statusesQuery = statusesQuery.eq('organization_id', organizationId);
  }

  const statusesResult = await statusesQuery;
  const allStatuses = dedupeStatuses(statusesResult.data ?? []);

  const ticketSelectFields =
    'id,title,due_datetime,execution_target,status,priority,assigned_agent,delegate,recent_agent,is_read,updated_at,board_position,organization_id,project_id,everhour_task_id,schedule_id,organization:organizations(name),project:projects(name,color,everhour_project_id)';

  const ticketQueriesPromise =
    view === 'calendar'
      ? (async () => {
          let query = supabase
            .from('tickets')
            .select(ticketSelectFields)
            .not('due_datetime', 'is', null)
            .order('due_datetime', { ascending: true })
            .limit(500);

          if (organizationId !== undefined) {
            query = query.eq('organization_id', organizationId);
          }
          if (projectId !== undefined) {
            query = query.eq('project_id', projectId);
          }

          const result = await query;
          return [result];
        })()
      : Promise.all(
          allStatuses.map(async status => {
            let query = supabase
              .from('tickets')
              .select(ticketSelectFields)
              .eq('status', status.name)
              .order('updated_at', { ascending: false })
              .limit(INITIAL_TICKETS_PER_STATUS);

            if (organizationId !== undefined) {
              query = query.eq('organization_id', organizationId);
            }

            if (projectId !== undefined) {
              query = query.eq('project_id', projectId);
            }

            return query;
          })
        );

  const [ticketResults, everhourIntegrationResult] = await Promise.all([
    ticketQueriesPromise,
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

  const ticketLoadError = ticketResults.find(result => result.error)?.error ?? null;
  const rawTickets = ticketResults.flatMap(result => (result.data ?? []) as RawTicket[]);
  const ticketIds = rawTickets.map(ticket => ticket.id);
  const latestSessionByTicket = new Map<
    string,
    { session_state: SessionState; agent_identifier: string }
  >();
  const waitingQuestionByTicket = new Map<string, string>();
  const executedObjectivesCountByTicket = new Map<string, number>();

  if (ticketIds.length > 0) {
    const [{ data: sessions }, { data: waitingQuestions }, { data: executedObjectives }] =
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
        assigned_agent: parseTicketAssignedAgent(ticket.assigned_agent),
        objective: null,
        project_id: ticket.project_id,
        organization_name: getOrganizationName(organization),
        project_name: p?.name ?? null,
        project_color: p?.color ?? null,
        project_everhour_project_id: hasEverhourApiKey ? (p?.everhour_project_id ?? null) : null,
        agent_session_state: session?.session_state ?? null,
        running_agent: isAttached ? session.agent_identifier : null,
        waiting_for_response_at: waitingQuestionByTicket.get(ticket.id) ?? null,
        objectives_executed_count: executedObjectivesCountByTicket.get(ticket.id) ?? 0,
        schedule_id: ticket.schedule_id ?? null
      };
    });
  const statuses = allStatuses;
  const loadError = ticketLoadError ?? statusesResult.error;
  let objectiveFileMentionPaths: string[] = [];
  let kanbanWorkingDirectory: string | null = null;

  const effectiveMentionProjectId = projectId ?? mentionProjectId;
  if (effectiveMentionProjectId && view === 'board') {
    const { data: projectForMentions } = await supabase
      .from('projects')
      .select('local_working_directory')
      .eq('id', effectiveMentionProjectId)
      .limit(1)
      .maybeSingle();

    if (isElectronRequest) {
      // In Electron, pass the raw configured path so the client can fetch files locally via IPC
      kanbanWorkingDirectory = projectForMentions?.local_working_directory ?? null;
    } else {
      const resolvedProjectDirectory = resolveLinkedDirectory(
        projectForMentions?.local_working_directory
      );
      if (resolvedProjectDirectory) {
        kanbanWorkingDirectory = resolvedProjectDirectory;
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
  }

  const showBoard = view === 'board' && statuses.length > 0;
  const showCalendar = view === 'calendar';

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      {loadError ? (
        <Alert variant="destructive" className="mx-4 md:mx-6">
          <AlertDescription>Failed to load tickets: {loadError.message}</AlertDescription>
        </Alert>
      ) : null}

      {showCalendar ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 md:px-6">
          <CalendarView
            tickets={tickets}
            completeStatusName={
              statuses.find(
                status =>
                  status.status_type === 'complete' &&
                  status.name.trim().toLowerCase() !== 'cancelled'
              )?.name ?? statuses.find(status => status.status_type === 'complete')?.name
            }
            initialView={view}
            showViewToggle={!isMobile}
            projectId={projectId}
            ticketUrlBase={projectId ? `/projects/${projectId}` : '/u'}
          />
        </div>
      ) : showBoard ? (
        <KanbanBoard
          tickets={tickets}
          statuses={statuses}
          showOrganizationName={showOrganizationName}
          organizationId={organizationId}
          projectId={projectId}
          fileMentionPaths={objectiveFileMentionPaths}
          workingDirectory={kanbanWorkingDirectory}
          initialView={view}
          initialHiddenColumns={initialHiddenColumns}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 md:px-6">
          <TicketListView
            tickets={tickets}
            showOrganizationName={showOrganizationName}
            ticketUrlBase={projectId ? `/projects/${projectId}` : '/u'}
            initialView={view}
            showViewToggle={!isMobile}
            projectId={projectId}
            initialListFilters={initialListFilters}
          />
        </div>
      )}
    </div>
  );
}
