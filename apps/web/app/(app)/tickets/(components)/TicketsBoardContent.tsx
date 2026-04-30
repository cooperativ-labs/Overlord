import { headers } from 'next/headers';

import { getProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { getRawViewPreference } from '@/lib/actions/view-preference';
import type { BoardScope, BoardStatus } from '@/lib/client-data/tickets/board-types';
import { listProjectFiles, resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { parseTicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { createClientForRequest } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

import TicketsBoardClient from './TicketsBoardClient';

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

// Cross-org boards collapse statuses to one column per status_type so columns
// stay coherent even when each org defines its own status names. Position
// ordering matches the canonical workflow.
const STATUS_TYPE_ORDER: Array<{ name: string; status_type: string; position: number }> = [
  { name: 'draft', status_type: 'draft', position: 0 },
  { name: 'execute', status_type: 'execute', position: 1 },
  { name: 'review', status_type: 'review', position: 2 },
  { name: 'complete', status_type: 'complete', position: 3 }
];

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
  is_read: boolean;
  updated_at: string;
  board_position: number;
  organization_id: number;
  project_id: string | null;
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
  // This is the initial view the client will show. Mobile can only show list or calendar.
  const initialView = isMobile
    ? preferredView === 'calendar'
      ? 'calendar'
      : 'list'
    : (preferredView ?? 'board');
  const initialHiddenColumns = projectPreferences?.hidden_columns ?? [];
  const initialListFilters = projectPreferences?.list_filters ?? null;
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // In cross-org mode (no org filter) we need (organization_id, name)→status_type
  // so each ticket can be remapped to its synthetic status_type column.
  const isCrossOrg = organizationId === undefined;

  let statusesQuery = supabase
    .from('ticket_statuses')
    .select('organization_id,name,position,status_type')
    .order('position', { ascending: true });

  if (organizationId !== undefined) {
    statusesQuery = statusesQuery.eq('organization_id', organizationId);
  }

  const statusesResult = await statusesQuery;
  const rawStatusRows = (statusesResult.data ?? []) as Array<{
    organization_id: number;
    name: string;
    position: number;
    status_type?: string;
  }>;

  // Build a (organization_id, status_name) → status_type lookup used to remap
  // ticket.status into a synthetic status_type column id when cross-org.
  const statusTypeByOrgAndName = new Map<string, string>();
  if (isCrossOrg) {
    for (const row of rawStatusRows) {
      if (row.status_type) {
        statusTypeByOrgAndName.set(`${row.organization_id}:${row.name}`, row.status_type);
      }
    }
  }

  const allStatuses = isCrossOrg
    ? STATUS_TYPE_ORDER.map(s => ({
        name: s.name,
        position: s.position,
        status_type: s.status_type
      }))
    : dedupeStatuses(rawStatusRows);

  const ticketSelectFields =
    'id,title,due_datetime,execution_target,status,priority,assigned_agent,delegate,is_read,updated_at,board_position,organization_id,project_id,everhour_task_id,schedule_id,organization:organizations(name),project:projects(name,color,everhour_project_id)';

  // Always fetch board/list data (per-status). Calendar data is fetched
  // client-side on demand via TanStack Query prefetch in TicketsBoardClient.
  // Cross-org boards bulk-fetch (no per-status filter) since status names
  // differ across orgs; we group client-side after remapping to status_type.
  const ticketQueriesPromise = isCrossOrg
    ? Promise.all([
        (async () => {
          let query = supabase
            .from('tickets')
            .select(ticketSelectFields)
            .order('updated_at', { ascending: false })
            .limit(INITIAL_TICKETS_PER_STATUS * STATUS_TYPE_ORDER.length);

          if (projectId !== undefined) {
            query = query.eq('project_id', projectId);
          }

          return query;
        })()
      ])
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
  const latestObjectiveAgentByTicket = new Map<string, string | null>();
  const objectiveAgentByTicket = new Map<string, string>();

  if (ticketIds.length > 0) {
    const [{ data: sessions }, { data: waitingQuestions }, { data: objectives }] =
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
          .from('objectives')
          .select('ticket_id,state,agent_identifier')
          .in('ticket_id', ticketIds)
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

    for (const objective of (objectives ?? []) as Array<{
      ticket_id: string;
      state: string | null;
      agent_identifier: string | null;
    }>) {
      if (!latestObjectiveAgentByTicket.has(objective.ticket_id)) {
        latestObjectiveAgentByTicket.set(objective.ticket_id, objective.agent_identifier ?? null);
      }
      if (objective.state === 'complete') {
        executedObjectivesCountByTicket.set(
          objective.ticket_id,
          (executedObjectivesCountByTicket.get(objective.ticket_id) ?? 0) + 1
        );
      }
      if (
        objective.state === 'executing' &&
        objective.agent_identifier &&
        !objectiveAgentByTicket.has(objective.ticket_id)
      ) {
        objectiveAgentByTicket.set(objective.ticket_id, objective.agent_identifier);
      }
    }
  }

  const tickets = rawTickets.map(({ organization, project, ...ticket }) => {
    const p = getRelationItem(project);
    const session = latestSessionByTicket.get(ticket.id);
    const isAttached = session?.session_state === 'attached';
    const runningAgent =
      objectiveAgentByTicket.get(ticket.id) ?? (isAttached ? session.agent_identifier : null);
    // In cross-org mode, remap each ticket's raw per-org status to its
    // status_type so the board groups by canonical workflow stage.
    const remappedStatus = isCrossOrg
      ? (statusTypeByOrgAndName.get(`${ticket.organization_id}:${ticket.status}`) ?? ticket.status)
      : ticket.status;
    return {
      ...ticket,
      status: remappedStatus,
      assigned_agent: parseTicketAssignedAgent(ticket.assigned_agent),
      objective: null,
      project_id: ticket.project_id,
      organization_name: getOrganizationName(organization),
      project_name: p?.name ?? (ticket.project_id ? null : 'Personal'),
      project_color: p?.color ?? null,
      project_everhour_project_id:
        hasEverhourApiKey && ticket.project_id ? (p?.everhour_project_id ?? null) : null,
      agent_session_state: session?.session_state ?? null,
      latest_objective_agent: latestObjectiveAgentByTicket.get(ticket.id) ?? null,
      running_agent: runningAgent,
      has_executing_objective: objectiveAgentByTicket.has(ticket.id),
      waiting_for_response_at: waitingQuestionByTicket.get(ticket.id) ?? null,
      objectives_executed_count: executedObjectivesCountByTicket.get(ticket.id) ?? 0,
      schedule_id: ticket.schedule_id ?? null
    };
  });
  const statuses = allStatuses;
  const loadError = ticketLoadError ?? statusesResult.error;
  let objectiveFileMentionPaths: string[] = [];
  let kanbanWorkingDirectory: string | null = null;

  // Only resolve file mentions when the board view will be shown — it's a
  // board-specific feature and the listing can take up to 3 seconds.
  const effectiveMentionProjectId = projectId ?? mentionProjectId;
  if (effectiveMentionProjectId && initialView === 'board') {
    const {
      data: { user: currentUser }
    } = await supabase.auth.getUser();
    const { data: projectUserForMentions } = currentUser
      ? await supabase
          .from('project_user')
          .select('local_working_directory')
          .eq('user_id', currentUser.id)
          .eq('project_id', effectiveMentionProjectId)
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (isElectronRequest) {
      kanbanWorkingDirectory = projectUserForMentions?.local_working_directory ?? null;
    } else {
      const resolvedProjectDirectory = resolveLinkedDirectory(
        projectUserForMentions?.local_working_directory
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

  const boardScope: BoardScope = projectId
    ? { kind: 'project', projectId, organizationId }
    : { kind: 'user', organizationId };

  const boardBootstrapStatuses: BoardStatus[] = statuses.map(status => ({
    name: status.name,
    position: status.position,
    status_type: status.status_type
  }));

  const completeStatusName =
    statuses.find(
      status =>
        status.status_type === 'complete' && status.name.trim().toLowerCase() !== 'cancelled'
    )?.name ?? statuses.find(status => status.status_type === 'complete')?.name;

  return (
    <TicketsBoardClient
      initialView={initialView}
      organizationId={organizationId}
      projectId={projectId}
      showOrganizationName={showOrganizationName}
      tickets={tickets as Parameters<typeof TicketsBoardClient>[0]['tickets']}
      statuses={statuses}
      boardScope={boardScope}
      boardBootstrapStatuses={boardBootstrapStatuses}
      loadError={loadError}
      fileMentionPaths={objectiveFileMentionPaths}
      workingDirectory={kanbanWorkingDirectory}
      initialHiddenColumns={initialHiddenColumns}
      initialListFilters={initialListFilters}
      ticketUrlBase={projectId ? `/projects/${projectId}` : '/u'}
      completeStatusName={completeStatusName}
    />
  );
}
