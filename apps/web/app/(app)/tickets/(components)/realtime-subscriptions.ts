import type { QueryClient } from '@tanstack/react-query';

import {
  mergeTicketsIntoBoards,
  mergeWaitingQuestionIntoBoards,
  reconcileRealtimeTicketRow,
  updateTicketInBoards
} from '@/lib/client-data/tickets/cache';
import { parseObjectiveAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import {
  TICKET_CREATED_EVENT,
  TICKET_CREATED_STORAGE_KEY,
  type TicketCreatedEventDetail
} from '@/lib/helpers/ticket-board-events';
import {
  getOpenedWaitingTimestamps,
  getWaitingRaisedWhileOpenMap,
  markTicketWaitingRaised,
  type TicketOpenedTimestamps,
  type TicketRaisedWhileOpenMap
} from '@/lib/helpers/ticket-waiting-response';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

import type { Ticket } from './KanbanCard';
import {
  getEventMessage,
  getObjectivePayloadId,
  getObjectivePayloadTicketId,
  getSessionPayloadObjectiveId,
  getTopBoardPositionForStatus,
  isTicketCreatedDetail,
  mapRealtimeBoardTicketRow,
  mergeWaitingByTicket,
  playSound,
  type RealtimeBoardTicketRow,
  sendDesktopNotification
} from './realtime-helpers';
import { toBoardTicket } from './ticket-view-helpers';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];
type Objective = Database['public']['Tables']['objectives']['Row'];

export type RealtimeRefs = {
  waitingByTicketRef: React.RefObject<Record<string, string>>;
  openTicketIdRef: React.RefObject<string | null>;
  ticketIdsRef: React.RefObject<Set<string>>;
  ticketsByIdRef: React.RefObject<Map<string, Ticket>>;
  waitingSoundRef: React.RefObject<HTMLAudioElement | null>;
  reviewSoundRef: React.RefObject<HTMLAudioElement | null>;
  alertSoundRef: React.RefObject<HTMLAudioElement | null>;
};

export type RealtimeSetters = {
  setWaitingByTicket: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setOpenedWaitingTimestamps: React.Dispatch<React.SetStateAction<TicketOpenedTimestamps>>;
  setWaitingRaisedWhileOpen: React.Dispatch<React.SetStateAction<TicketRaisedWhileOpenMap>>;
};

// Sets up all Supabase realtime channels, DOM event listeners, and the
// 30-second polling safety net.  Returns a cleanup function.
export function setupRealtimeSubscriptions({
  organizationId,
  projectId,
  queryClient,
  removeTicketFromBoard,
  refs,
  setters
}: {
  organizationId?: number;
  projectId?: string;
  queryClient: QueryClient;
  removeTicketFromBoard: (ticketId: string) => void;
  refs: RealtimeRefs;
  setters: RealtimeSetters;
}): () => void {
  let cancelled = false;
  const supabase = createClient();

  const fetchRealtimeBoardTicket = async (ticketId: string): Promise<Ticket | null> => {
    let query = supabase
      .from('tickets')
      .select(
        'id,title,due_datetime,execution_target,status,priority,delegate,is_read,updated_at,board_position,organization_id,project_id,everhour_task_id,schedule_id,organization:organizations(name),project:projects(name,color,everhour_project_id)'
      )
      .eq('id', ticketId)
      .limit(1);

    if (organizationId !== undefined) {
      query = query.eq('organization_id', organizationId);
    }
    if (projectId !== undefined) {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query.maybeSingle();
    if (cancelled || error || !data) {
      return null;
    }

    return mapRealtimeBoardTicketRow(data as RealtimeBoardTicketRow);
  };

  const objectiveTicketCache = new Map<string, string>();

  const resolveTicketIdFromObjective = async (objectiveId: string): Promise<string | null> => {
    const cached = objectiveTicketCache.get(objectiveId);
    if (cached) return cached;
    const { data } = await supabase
      .from('objectives')
      .select('ticket_id')
      .eq('id', objectiveId)
      .maybeSingle();
    if (data?.ticket_id) {
      objectiveTicketCache.set(objectiveId, data.ticket_id);
    }
    return data?.ticket_id ?? null;
  };

  // Re-reads objective + session state for a ticket and pushes it into the board cache.
  const syncObjectiveStateForTicket = async (ticketId: string) => {
    const [{ data: objectives }, { data: sessions }] = await Promise.all([
      supabase
        .from('objectives')
        .select('state,agent_identifier,assigned_agent')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false }),
      supabase
        .from('agent_sessions')
        .select('session_state,agent_identifier,attached_at,objective:objectives!inner(ticket_id)')
        .eq('objective.ticket_id', ticketId)
        .order('attached_at', { ascending: false })
        .limit(1)
    ]);

    if (cancelled || !refs.ticketIdsRef.current.has(ticketId)) return;

    let latestObjectiveAgent: string | null = null;
    let latestObjectiveAssignedAgent: Objective['assigned_agent'] = null;
    let executingObjectiveAgent: string | null = null;
    let executedObjectivesCount = 0;

    for (const objective of (objectives ?? []) as Array<{
      state: string | null;
      agent_identifier: string | null;
      assigned_agent: Objective['assigned_agent'];
    }>) {
      if (latestObjectiveAgent === null) {
        latestObjectiveAgent = objective.agent_identifier ?? null;
      }
      if (latestObjectiveAssignedAgent === null) {
        latestObjectiveAssignedAgent = objective.assigned_agent;
      }
      if (objective.state === 'complete') {
        executedObjectivesCount += 1;
      }
      if (
        objective.state === 'executing' &&
        objective.agent_identifier &&
        executingObjectiveAgent === null
      ) {
        executingObjectiveAgent = objective.agent_identifier;
      }
    }

    const session = (sessions ?? [])[0] as
      | Pick<AgentSession, 'session_state' | 'agent_identifier'>
      | undefined;
    const isAttached = session?.session_state === 'attached';

    updateTicketInBoards(queryClient, ticketId, {
      agent_session_state: session?.session_state ?? null,
      latest_objective_agent: latestObjectiveAgent,
      assigned_agent: parseObjectiveAssignedAgent(latestObjectiveAssignedAgent),
      running_agent: executingObjectiveAgent ?? (isAttached ? session.agent_identifier : null),
      has_executing_objective: executingObjectiveAgent !== null,
      objectives_executed_count: executedObjectivesCount
    });
  };

  // Full board reconciliation — runs on channel errors and every 30s as a safety net.
  const syncBoardData = async () => {
    const ticketIds = [...refs.ticketIdsRef.current];
    if (ticketIds.length === 0) return;

    const [
      { data: sessions },
      { data: waitingQuestions },
      { data: ticketUpdates },
      { data: objectives }
    ] = await Promise.all([
      supabase
        .from('agent_sessions')
        .select('session_state,agent_identifier,attached_at,objective:objectives!inner(ticket_id)')
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
        .from('tickets')
        .select('id,status,title,delegate,is_read,board_position,updated_at')
        .in('id', ticketIds),
      supabase
        .from('objectives')
        .select('ticket_id,state,agent_identifier,assigned_agent')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: false })
    ]);

    if (cancelled) return;

    const latestObjectiveAgentByTicket = new Map<string, string | null>();
    const latestObjectiveAssignedAgentByTicket = new Map<string, Objective['assigned_agent']>();
    const executingObjectiveAgentByTicket = new Map<string, string>();
    const executedObjectivesCountByTicket = new Map<string, number>();
    const sessionByTicket = new Map<
      string,
      Pick<AgentSession, 'session_state' | 'agent_identifier'>
    >();
    for (const session of sessions ?? []) {
      const ticketId = (session.objective as unknown as { ticket_id: string })?.ticket_id;
      if (!ticketId || sessionByTicket.has(ticketId)) continue;
      sessionByTicket.set(ticketId, session);
    }

    const ticketUpdateMap = new Map(
      (
        (ticketUpdates ?? []) as Array<{
          id: string;
          status: string | null;
          title: string | null;
          delegate: string | null;
          is_read: boolean;
          board_position: number;
          updated_at: string;
        }>
      ).map(ticket => [ticket.id, ticket])
    );

    for (const objective of (objectives ?? []) as Array<{
      ticket_id: string;
      state: string | null;
      agent_identifier: string | null;
      assigned_agent: Objective['assigned_agent'];
    }>) {
      if (!latestObjectiveAgentByTicket.has(objective.ticket_id)) {
        latestObjectiveAgentByTicket.set(objective.ticket_id, objective.agent_identifier ?? null);
      }
      if (!latestObjectiveAssignedAgentByTicket.has(objective.ticket_id)) {
        latestObjectiveAssignedAgentByTicket.set(objective.ticket_id, objective.assigned_agent);
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
        !executingObjectiveAgentByTicket.has(objective.ticket_id)
      ) {
        executingObjectiveAgentByTicket.set(objective.ticket_id, objective.agent_identifier);
      }
    }

    for (const ticket of refs.ticketsByIdRef.current.values()) {
      const update = ticketUpdateMap.get(ticket.id);
      if (!update) continue;
      const session = sessionByTicket.get(ticket.id);
      const isAttached = session?.session_state === 'attached';
      const runningAgent =
        executingObjectiveAgentByTicket.get(ticket.id) ??
        (isAttached ? session.agent_identifier : null);
      updateTicketInBoards(queryClient, ticket.id, {
        status: update.status ?? ticket.status,
        title: update.title ?? ticket.title,
        is_read: update.is_read ?? ticket.is_read,
        board_position: update.board_position ?? ticket.board_position,
        updated_at: update.updated_at ?? ticket.updated_at,
        latest_objective_agent:
          latestObjectiveAgentByTicket.get(ticket.id) ?? ticket.latest_objective_agent,
        assigned_agent:
          parseObjectiveAssignedAgent(
            latestObjectiveAssignedAgentByTicket.get(ticket.id) ?? null
          ) ?? ticket.assigned_agent,
        delegate: update.delegate,
        agent_session_state: session?.session_state ?? ticket.agent_session_state ?? null,
        running_agent: runningAgent,
        has_executing_objective: executingObjectiveAgentByTicket.has(ticket.id),
        objectives_executed_count:
          executedObjectivesCountByTicket.get(ticket.id) ?? ticket.objectives_executed_count ?? 0
      });
    }

    const nextWaitingByTicket = { ...refs.waitingByTicketRef.current };
    const raisedWaitingTicketIds: string[] = [];
    let waitingChanged = false;
    for (const question of (waitingQuestions ?? []) as {
      ticket_id: string;
      created_at: string;
    }[]) {
      if (
        !nextWaitingByTicket[question.ticket_id] ||
        Date.parse(question.created_at) > Date.parse(nextWaitingByTicket[question.ticket_id])
      ) {
        nextWaitingByTicket[question.ticket_id] = question.created_at;
        mergeWaitingQuestionIntoBoards(queryClient, question);
        raisedWaitingTicketIds.push(question.ticket_id);
        waitingChanged = true;
      }
    }
    if (waitingChanged) {
      setters.setWaitingByTicket(nextWaitingByTicket);
      for (const ticketId of raisedWaitingTicketIds) {
        markTicketWaitingRaised(ticketId, refs.openTicketIdRef.current === ticketId);
      }
      setters.setOpenedWaitingTimestamps(getOpenedWaitingTimestamps());
      setters.setWaitingRaisedWhileOpen(getWaitingRaisedWhileOpenMap());
    }
  };

  // --- Event handlers ---

  const handleCreatedTicketSignal = (detail: TicketCreatedEventDetail) => {
    if (organizationId !== undefined && detail.organizationId !== organizationId) return;
    if (projectId !== undefined && detail.projectId !== projectId) return;

    void (async () => {
      const ticket = await fetchRealtimeBoardTicket(detail.ticketId);
      if (!ticket) return;
      mergeTicketsIntoBoards(queryClient, [toBoardTicket(ticket)], 'realtime');
      setters.setWaitingByTicket(previous => mergeWaitingByTicket(previous, [ticket]));
    })();
  };

  const handleQuestionEvent = (event: TicketEvent) => {
    if (!event.is_blocking) return;
    if (!refs.ticketIdsRef.current.has(event.ticket_id)) return;
    mergeWaitingQuestionIntoBoards(queryClient, event);

    setters.setWaitingByTicket(previous => {
      const existing = previous[event.ticket_id];
      if (existing && Date.parse(existing) >= Date.parse(event.created_at)) {
        return previous;
      }
      return { ...previous, [event.ticket_id]: event.created_at };
    });
    markTicketWaitingRaised(event.ticket_id, refs.openTicketIdRef.current === event.ticket_id);
    setters.setOpenedWaitingTimestamps(getOpenedWaitingTimestamps());
    setters.setWaitingRaisedWhileOpen(getWaitingRaisedWhileOpenMap());

    const ticket = refs.ticketsByIdRef.current.get(event.ticket_id);
    const title = ticket?.title?.trim()
      ? `Agent waiting: ${ticket.title.trim()}`
      : 'Agent waiting for response';

    sendDesktopNotification(title, getEventMessage(event));
    playSound(refs.waitingSoundRef.current);
  };

  const handleStatusChangeEvent = (event: TicketEvent) => {
    if (!event.phase) return;
    if (!refs.ticketIdsRef.current.has(event.ticket_id)) return;

    const shouldMoveToTopOfReview = event.phase === 'review' && event.objective_id !== null;
    const existingTicket = refs.ticketsByIdRef.current.get(event.ticket_id);
    updateTicketInBoards(queryClient, event.ticket_id, {
      status: event.phase,
      board_position:
        shouldMoveToTopOfReview && existingTicket
          ? getTopBoardPositionForStatus(
              [...refs.ticketsByIdRef.current.values()],
              event.phase,
              event.ticket_id
            )
          : existingTicket?.board_position,
      updated_at: event.created_at ?? existingTicket?.updated_at,
      ...(refs.openTicketIdRef.current !== event.ticket_id ? { is_read: false } : {})
    });

    if (event.phase !== 'review') return;

    playSound(refs.reviewSoundRef.current);

    const reviewTicket = refs.ticketsByIdRef.current.get(event.ticket_id);
    const reviewTitle = reviewTicket?.title?.trim()
      ? `Ready for review: ${reviewTicket.title.trim()}`
      : 'Ticket moved to review';
    sendDesktopNotification(reviewTitle, 'The agent has delivered this ticket.');
  };

  const handleAlertEvent = (event: TicketEvent) => {
    if (!refs.ticketIdsRef.current.has(event.ticket_id)) return;

    const ticket = refs.ticketsByIdRef.current.get(event.ticket_id);
    const title = ticket?.title?.trim() ? `Agent alert: ${ticket.title.trim()}` : 'Agent alert';

    sendDesktopNotification(title, getEventMessage(event));
    playSound(refs.alertSoundRef.current);
  };

  const handleTicketCreated = (event: Event) => {
    const detail = (event as CustomEvent<TicketCreatedEventDetail>).detail;
    if (!detail) return;
    handleCreatedTicketSignal(detail);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== TICKET_CREATED_STORAGE_KEY || !event.newValue) return;
    try {
      const parsed: unknown = JSON.parse(event.newValue);
      if (!isTicketCreatedDetail(parsed)) return;
      handleCreatedTicketSignal(parsed);
    } catch {
      // Ignore malformed storage payloads.
    }
  };

  // --- Channel setup ---

  let channel = supabase.channel(
    `tickets-realtime:${organizationId ?? 'all'}:${projectId ?? 'all'}`
  );

  channel = channel
    .on<TicketEvent>(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ticket_events' },
      payload => {
        const event = payload.new;
        if (!refs.ticketIdsRef.current.has(event.ticket_id)) return;
        if (event.event_type === 'question') {
          handleQuestionEvent(event);
          return;
        }
        if (event.event_type === 'status_change') {
          handleStatusChangeEvent(event);
          return;
        }
        if (event.event_type === 'alert') {
          handleAlertEvent(event);
        }
      }
    )
    .on<AgentSession>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'agent_sessions' },
      payload => {
        const objectiveId =
          getSessionPayloadObjectiveId(payload.new) ?? getSessionPayloadObjectiveId(payload.old);
        if (!objectiveId) return;
        void (async () => {
          const ticketId = await resolveTicketIdFromObjective(objectiveId);
          if (!ticketId || !refs.ticketIdsRef.current.has(ticketId)) return;
          await syncObjectiveStateForTicket(ticketId);
        })();
      }
    )
    .on<Objective>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'objectives' },
      payload => {
        const changedTicketId =
          getObjectivePayloadTicketId(payload.new) ?? getObjectivePayloadTicketId(payload.old);
        if (!changedTicketId) return;
        const objectiveId =
          getObjectivePayloadId(payload.new) ?? getObjectivePayloadId(payload.old);
        if (objectiveId) {
          objectiveTicketCache.set(objectiveId, changedTicketId);
        }
        if (!refs.ticketIdsRef.current.has(changedTicketId)) return;
        void syncObjectiveStateForTicket(changedTicketId);
      }
    )
    .on<Database['public']['Tables']['tickets']['Row']>(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'tickets',
        ...(organizationId ? { filter: `organization_id=eq.${organizationId}` } : {})
      },
      payload => {
        const inserted = payload.new;
        if (projectId && inserted.project_id !== projectId) return;

        void (async () => {
          const ticket = await fetchRealtimeBoardTicket(inserted.id);
          if (!ticket) return;
          mergeTicketsIntoBoards(queryClient, [toBoardTicket(ticket)], 'realtime');
          setters.setWaitingByTicket(previous => mergeWaitingByTicket(previous, [ticket]));
        })();
      }
    )
    .on<Database['public']['Tables']['tickets']['Row']>(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tickets',
        ...(organizationId ? { filter: `organization_id=eq.${organizationId}` } : {})
      },
      payload => {
        const updated = payload.new;
        if (!refs.ticketIdsRef.current.has(updated.id)) return;
        reconcileRealtimeTicketRow(queryClient, {
          id: updated.id,
          status: updated.status ?? undefined,
          title: updated.title,
          is_read: updated.is_read,
          board_position: updated.board_position,
          updated_at: updated.updated_at,
          delegate: updated.delegate
        });
      }
    )
    .on<Database['public']['Tables']['tickets']['Row']>(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'tickets' },
      payload => {
        const deletedId = payload.old.id;
        if (!deletedId || !refs.ticketIdsRef.current.has(deletedId)) return;
        removeTicketFromBoard(deletedId);
      }
    )
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        void syncBoardData();
      }
    });

  window.addEventListener(TICKET_CREATED_EVENT, handleTicketCreated);
  window.addEventListener('storage', handleStorage);

  // Safety net: reconcile every 30s so the board never strands on stale state.
  const pollId = window.setInterval(() => {
    void syncBoardData();
  }, 30_000);

  return () => {
    cancelled = true;
    window.clearInterval(pollId);
    window.removeEventListener(TICKET_CREATED_EVENT, handleTicketCreated);
    window.removeEventListener('storage', handleStorage);
    void supabase.removeChannel(channel);
  };
}
