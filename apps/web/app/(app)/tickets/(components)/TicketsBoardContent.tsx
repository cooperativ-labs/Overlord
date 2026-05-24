import type { SupabaseClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';

import { getGlobalListViewPreferencesAction } from '@/lib/actions/global-list-view-preferences';
import { getProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { getScheduledTicketVisibilityDaysForUser } from '@/lib/actions/scheduled-ticket-visibility-preference';
import { getRawViewPreference } from '@/lib/actions/view-preference';
import type { BoardScope, BoardStatus } from '@/lib/client-data/tickets/board-types';
import { listProjectFiles, resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import {
  getScheduledTicketVisibilityWindow,
  mergeRowsById
} from '@/lib/helpers/scheduled-ticket-visibility';
import { parseObjectiveAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { isDraftObjectiveWithText } from '@/lib/helpers/tickets';
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

function toLoadError(error: unknown): { message: string } | null {
  if (!error) {
    return null;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return { message };
    }
  }

  return { message: 'Failed to load tickets' };
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
  ticket_id: string | null;
  ticket_sequence: number;
  title: string | null;
  objective?: string | null;
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
  objectives_executed_count?: number;
  has_draft_objective_with_text?: boolean;
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
  'objective_id' | 'session_state' | 'agent_identifier'
>;
type WaitingQuestionForBoard = Pick<
  Database['public']['Tables']['ticket_events']['Row'],
  'ticket_id' | 'created_at'
>;
const INITIAL_TICKETS_PER_STATUS = 20;
const ALL_TICKETS_PAGE_SIZE = 1000;

async function loadTicketsForStatus(
  supabase: SupabaseClient<Database>,
  {
    status,
    statusType,
    organizationId,
    projectId,
    ticketSelectFields,
    window
  }: {
    status: string;
    statusType?: string;
    organizationId?: number;
    projectId?: string;
    ticketSelectFields: string;
    window: { startIso: string; endIso: string } | null;
  }
): Promise<RawTicket[]> {
  if (statusType !== 'complete') {
    return loadAllTicketsForStatus(supabase, {
      status,
      organizationId,
      projectId,
      ticketSelectFields
    });
  }

  let recentQuery = supabase
    .from('tickets')
    .select(ticketSelectFields)
    .eq('status', status)
    .order('board_position', { ascending: true })
    .limit(INITIAL_TICKETS_PER_STATUS);

  if (organizationId !== undefined) {
    recentQuery = recentQuery.eq('organization_id', organizationId);
  }

  if (projectId !== undefined) {
    recentQuery = recentQuery.eq('project_id', projectId);
  }

  const { data: recentTickets, error: recentError } = await recentQuery;
  if (recentError) {
    throw recentError;
  }

  if (!window) {
    return (recentTickets ?? []) as unknown as RawTicket[];
  }

  let scheduledQuery = supabase
    .from('tickets')
    .select(ticketSelectFields)
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
    throw scheduledError;
  }

  return mergeRowsById(
    (recentTickets ?? []) as unknown as RawTicket[],
    (scheduledTickets ?? []) as unknown as RawTicket[]
  );
}

async function loadAllTicketsForStatus(
  supabase: SupabaseClient<Database>,
  {
    status,
    organizationId,
    projectId,
    ticketSelectFields
  }: {
    status: string;
    organizationId?: number;
    projectId?: string;
    ticketSelectFields: string;
  }
): Promise<RawTicket[]> {
  const rows: RawTicket[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from('tickets')
      .select(ticketSelectFields)
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
      throw error;
    }

    const batch = (data ?? []) as unknown as RawTicket[];
    rows.push(...batch);
    if (batch.length < ALL_TICKETS_PAGE_SIZE) {
      return rows;
    }
    offset += ALL_TICKETS_PAGE_SIZE;
  }
}

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

  const [projectPreferences, globalListPrefs] = await Promise.all([
    projectId ? getProjectUserPreferencesAction(projectId) : null,
    !projectId ? getGlobalListViewPreferencesAction() : null
  ]);

  const preferredView = projectPreferences?.preferred_view ?? savedView;
  // This is the initial view the client will show. Mobile can only show list or calendar.
  const initialView = isMobile
    ? preferredView === 'calendar'
      ? 'calendar'
      : 'list'
    : (preferredView ?? 'board');
  const initialHiddenColumns = projectPreferences?.hidden_columns ?? [];
  const initialListFilters = projectPreferences?.list_filters ?? null;
  const initialCollapsedStatuses =
    projectPreferences?.list_collapsed_statuses ?? globalListPrefs?.list_collapsed_statuses ?? [];
  const initialStatusOrder =
    projectPreferences?.list_status_order ?? globalListPrefs?.list_status_order ?? [];
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const scheduledVisibilityDays = user
    ? await getScheduledTicketVisibilityDaysForUser(supabase, user.id)
    : 0;
  const scheduledWindow = getScheduledTicketVisibilityWindow(scheduledVisibilityDays);

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

  const allStatuses = dedupeStatuses(rawStatusRows);

  const ticketSelectFields =
    'id,ticket_id,ticket_sequence,title,due_datetime,for_human,status,priority,delegate,is_read,updated_at,board_position,organization_id,project_id,everhour_task_id,schedule_id,organization:organizations(name),project:projects(name,color,everhour_project_id)';

  // Always fetch board/list data per status. Calendar data is fetched
  // client-side on demand via TanStack Query prefetch in TicketsBoardClient.
  const ticketQueriesPromise = Promise.all(
    allStatuses.map(async status => {
      try {
        const data = await loadTicketsForStatus(supabase, {
          status: status.name,
          statusType: status.status_type,
          organizationId,
          projectId,
          ticketSelectFields,
          window: scheduledWindow
        });
        return { data, error: null };
      } catch (error) {
        return { data: [], error };
      }
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
  const hasDraftObjectiveWithTextByTicket = new Map<string, boolean>();
  const latestObjectiveAgentByTicket = new Map<string, string | null>();
  const latestObjectiveAssignedAgentByTicket = new Map<
    string,
    Database['public']['Tables']['objectives']['Row']['assigned_agent']
  >();
  const objectiveAgentByTicket = new Map<string, string>();

  if (ticketIds.length > 0) {
    const [{ data: sessions }, { data: waitingQuestions }, { data: objectives }] =
      await Promise.all([
        supabase
          .from('agent_sessions')
          .select('session_state,agent_identifier,objective:objectives!inner(ticket_id)')
          .in('objective.ticket_id', ticketIds)
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
          .select('ticket_id,state,objective,agent_identifier,assigned_agent')
          .in('ticket_id', ticketIds)
          .order('created_at', { ascending: false })
      ]);

    for (const session of sessions ?? []) {
      const ticketId = (session.objective as unknown as { ticket_id: string })?.ticket_id;
      if (!ticketId || latestSessionByTicket.has(ticketId)) continue;
      latestSessionByTicket.set(ticketId, {
        session_state: session.session_state,
        agent_identifier: session.agent_identifier
      });
    }

    for (const waitingQuestion of (waitingQuestions ?? []) as WaitingQuestionForBoard[]) {
      if (!waitingQuestionByTicket.has(waitingQuestion.ticket_id)) {
        waitingQuestionByTicket.set(waitingQuestion.ticket_id, waitingQuestion.created_at);
      }
    }

    for (const objective of (objectives ?? []) as Array<{
      ticket_id: string;
      state: string | null;
      objective: string | null;
      agent_identifier: string | null;
      assigned_agent: Database['public']['Tables']['objectives']['Row']['assigned_agent'];
    }>) {
      if (!latestObjectiveAgentByTicket.has(objective.ticket_id)) {
        latestObjectiveAgentByTicket.set(objective.ticket_id, objective.agent_identifier ?? null);
      }
      // Use the most recently created objective that has a non-null assigned_agent, so that
      // a newly created empty draft (which inherits from the prior objective) doesn't shadow
      // the actual agent selection with a null value.
      if (
        !latestObjectiveAssignedAgentByTicket.has(objective.ticket_id) &&
        objective.assigned_agent !== null
      ) {
        latestObjectiveAssignedAgentByTicket.set(objective.ticket_id, objective.assigned_agent);
      }
      if (objective.state === 'complete') {
        executedObjectivesCountByTicket.set(
          objective.ticket_id,
          (executedObjectivesCountByTicket.get(objective.ticket_id) ?? 0) + 1
        );
      }
      if (
        isDraftObjectiveWithText(objective) &&
        !hasDraftObjectiveWithTextByTicket.has(objective.ticket_id)
      ) {
        hasDraftObjectiveWithTextByTicket.set(objective.ticket_id, true);
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
    return {
      ...ticket,
      status: ticket.status,
      assigned_agent: parseObjectiveAssignedAgent(
        latestObjectiveAssignedAgentByTicket.get(ticket.id) ?? null
      ),
      objective: null,
      project_id: ticket.project_id,
      organization_name: getOrganizationName(organization),
      project_name: p?.name ?? (ticket.project_id ? null : 'Inbox'),
      project_color: p?.color ?? null,
      project_everhour_project_id:
        hasEverhourApiKey && ticket.project_id ? (p?.everhour_project_id ?? null) : null,
      agent_session_state: session?.session_state ?? null,
      latest_objective_agent: latestObjectiveAgentByTicket.get(ticket.id) ?? null,
      running_agent: runningAgent,
      has_executing_objective: objectiveAgentByTicket.has(ticket.id),
      waiting_for_response_at: waitingQuestionByTicket.get(ticket.id) ?? null,
      objectives_executed_count: executedObjectivesCountByTicket.get(ticket.id) ?? 0,
      has_draft_objective_with_text: hasDraftObjectiveWithTextByTicket.get(ticket.id) ?? false,
      schedule_id: ticket.schedule_id ?? null
    };
  });
  const statuses = allStatuses;
  const loadError = toLoadError(ticketLoadError) ?? toLoadError(statusesResult.error);
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
      initialCollapsedStatuses={initialCollapsedStatuses}
      initialStatusOrder={initialStatusOrder}
      scheduledVisibilityDays={scheduledVisibilityDays}
      ticketUrlBase={projectId ? `/projects/${projectId}` : '/u'}
      completeStatusName={completeStatusName}
    />
  );
}
