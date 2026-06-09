import type { QueryClient } from '@tanstack/react-query';

import {
  getBoardEntries,
  mergeTicketsIntoBoards,
  mergeWaitingQuestionIntoBoards,
  reconcileRealtimeTicketRow,
  updateTicketInBoards
} from '@/lib/client-data/tickets/cache';
import { parseObjectiveAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import {
  aggregateObjectivesByTicket,
  indexLatestSessionByTicket,
  type ObjectiveAggregationRow,
  resolveRunningAgent,
  type SessionAggregationRow,
  WAITING_TICKET_EVENT_TYPES
} from '@/lib/helpers/ticket-board-aggregation';
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
import {
  isWaitingOnHumanEvent,
  resolveObjectiveNotificationIntent
} from '@/lib/overlord/objective-notifications';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';
import type { Ticket } from '@/types/tickets';

import {
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

const REALTIME_BOARD_TICKET_SELECT =
  'id,ticket_id,ticket_sequence,title,due_datetime,for_human,status,priority,delegate,is_read,updated_at,board_position,organization_id,project_id,everhour_task_id,schedule_id,organization:organizations(name),project:projects(name,color,everhour_project_id)';

// How long to wait before rebuilding a failed realtime channel. Doubles per
// consecutive failure up to the cap; resets once a subscribe succeeds.
const RESUBSCRIBE_BASE_DELAY_MS = 2_000;
const RESUBSCRIBE_MAX_DELAY_MS = 30_000;
const POLL_INTERVAL_MS = 30_000;
// Upper bound on tickets discovered per reconcile pass. New tickets arrive via
// the INSERT handler when the channel is healthy; discovery only has to cover
// what was missed while it was down.
const DISCOVERY_LIMIT = 50;

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
// polling/wake-up reconciliation safety nets. Returns a cleanup function.
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

  const isTicketInScope = (ticket: { organization_id?: number; project_id?: string | null }) => {
    if (organizationId !== undefined && ticket.organization_id !== organizationId) return false;
    if (projectId !== undefined && ticket.project_id !== projectId) return false;
    return true;
  };

  const fetchRealtimeBoardTicket = async (ticketId: string): Promise<Ticket | null> => {
    let query = supabase
      .from('tickets')
      .select(REALTIME_BOARD_TICKET_SELECT)
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

  const mergeFetchedTicket = async (ticketId: string) => {
    const ticket = await fetchRealtimeBoardTicket(ticketId);
    if (!ticket || cancelled) return;
    mergeTicketsIntoBoards(queryClient, [toBoardTicket(ticket)], 'realtime');
    setters.setWaitingByTicket(previous => mergeWaitingByTicket(previous, [ticket]));
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
        .select('ticket_id,state,objective,agent_identifier,assigned_agent')
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

    const aggregate = aggregateObjectivesByTicket(
      (objectives ?? []) as ObjectiveAggregationRow[]
    ).get(ticketId);
    const session = (sessions ?? [])[0] as
      | Pick<AgentSession, 'session_state' | 'agent_identifier'>
      | undefined;

    updateTicketInBoards(queryClient, ticketId, {
      agent_session_state: session?.session_state ?? null,
      latest_objective_agent: aggregate?.latestObjectiveAgent ?? null,
      assigned_agent: parseObjectiveAssignedAgent(
        (aggregate?.latestAssignedAgent ?? null) as Objective['assigned_agent']
      ),
      running_agent: resolveRunningAgent(aggregate, session),
      has_executing_objective: aggregate?.hasExecutingObjective ?? false,
      objectives_executed_count: aggregate?.executedObjectivesCount ?? 0,
      has_draft_objective_with_text: aggregate?.hasDraftObjectiveWithText ?? false
    });
  };

  // Coalesce bursts of objective/session events per ticket: one fetch in
  // flight at a time, with a single trailing re-run if more events arrived.
  const objectiveSyncInFlight = new Map<string, { rerun: boolean }>();
  const requestObjectiveSync = (ticketId: string) => {
    const inFlight = objectiveSyncInFlight.get(ticketId);
    if (inFlight) {
      inFlight.rerun = true;
      return;
    }
    const marker = { rerun: false };
    objectiveSyncInFlight.set(ticketId, marker);
    void syncObjectiveStateForTicket(ticketId)
      .catch(() => undefined)
      .finally(() => {
        objectiveSyncInFlight.delete(ticketId);
        if (marker.rerun && !cancelled) requestObjectiveSync(ticketId);
      });
  };

  // Find tickets that changed after everything the board knows about — these
  // are creations (or scope moves) that realtime missed while disconnected.
  const discoverUnknownTickets = async (): Promise<RealtimeBoardTicketRow[]> => {
    let newestKnownUpdatedAt: string | null = null;
    for (const ticket of refs.ticketsByIdRef.current.values()) {
      if (
        ticket.updated_at &&
        (!newestKnownUpdatedAt || Date.parse(ticket.updated_at) > Date.parse(newestKnownUpdatedAt))
      ) {
        newestKnownUpdatedAt = ticket.updated_at;
      }
    }

    let query = supabase
      .from('tickets')
      .select(REALTIME_BOARD_TICKET_SELECT)
      .order('updated_at', { ascending: false })
      .limit(DISCOVERY_LIMIT);

    if (organizationId !== undefined) {
      query = query.eq('organization_id', organizationId);
    }
    if (projectId !== undefined) {
      query = query.eq('project_id', projectId);
    }
    if (newestKnownUpdatedAt) {
      query = query.gt('updated_at', newestKnownUpdatedAt);
    }

    const { data, error } = await query;
    if (error || !data) return [];
    return (data as RealtimeBoardTicketRow[]).filter(row => !refs.ticketIdsRef.current.has(row.id));
  };

  // Full board reconciliation — runs on subscribe/error transitions, on tab
  // wake-up / network reconnect, and on a fixed interval as a safety net.
  // Discovers tickets created while realtime was down, removes tickets that
  // were deleted or moved out of scope, and refreshes every known ticket.
  let syncInFlight = false;
  const syncBoardData = async () => {
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      await runBoardSync();
    } finally {
      syncInFlight = false;
    }
  };

  const runBoardSync = async () => {
    const discoveredRows = await discoverUnknownTickets();
    if (cancelled) return;

    const knownTicketIds = [...refs.ticketIdsRef.current];
    const ticketIds = [...knownTicketIds, ...discoveredRows.map(row => row.id)];
    if (ticketIds.length === 0) return;

    const [
      { data: sessions },
      { data: waitingQuestions },
      { data: ticketUpdates, error: ticketUpdatesError },
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
        .in('event_type', [...WAITING_TICKET_EVENT_TYPES])
        .eq('is_blocking', true)
        .order('created_at', { ascending: false }),
      supabase
        .from('tickets')
        .select(
          'id,status,title,delegate,is_read,board_position,updated_at,organization_id,project_id'
        )
        .in('id', ticketIds),
      supabase
        .from('objectives')
        .select('ticket_id,state,objective,agent_identifier,assigned_agent')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: false })
    ]);

    if (cancelled) return;

    const aggregateByTicket = aggregateObjectivesByTicket(
      (objectives ?? []) as ObjectiveAggregationRow[]
    );
    const sessionByTicket = indexLatestSessionByTicket(
      (sessions ?? []) as Array<
        SessionAggregationRow & {
          objective: { ticket_id: string } | Array<{ ticket_id: string }> | null;
        }
      >
    );

    type TicketUpdateRow = {
      id: string;
      status: string | null;
      title: string | null;
      delegate: string | null;
      is_read: boolean;
      board_position: number;
      updated_at: string;
      organization_id: number;
      project_id: string | null;
    };
    const ticketUpdateMap = new Map(
      ((ticketUpdates ?? []) as TicketUpdateRow[]).map(ticket => [ticket.id, ticket])
    );

    // Merge tickets that were created (or moved into scope) while offline.
    if (discoveredRows.length > 0) {
      const discoveredTickets = discoveredRows.map(row => {
        const ticket = mapRealtimeBoardTicketRow(row);
        const aggregate = aggregateByTicket.get(ticket.id);
        const session = sessionByTicket.get(ticket.id);
        return {
          ...ticket,
          agent_session_state: (session?.session_state as Ticket['agent_session_state']) ?? null,
          latest_objective_agent: aggregate?.latestObjectiveAgent ?? null,
          assigned_agent: parseObjectiveAssignedAgent(
            (aggregate?.latestAssignedAgent ?? null) as Objective['assigned_agent']
          ),
          running_agent: resolveRunningAgent(aggregate, session),
          has_executing_objective: aggregate?.hasExecutingObjective ?? false,
          objectives_executed_count: aggregate?.executedObjectivesCount ?? 0,
          has_draft_objective_with_text: aggregate?.hasDraftObjectiveWithText ?? false
        };
      });
      mergeTicketsIntoBoards(queryClient, discoveredTickets.map(toBoardTicket), 'server-poll');
      setters.setWaitingByTicket(previous => mergeWaitingByTicket(previous, discoveredTickets));
    }

    // A missing row means the ticket was deleted or is no longer visible —
    // but only for ids we actually queried, when the query succeeded, and
    // never for tickets with an in-flight optimistic create (the server row
    // may not exist yet).
    const queriedIds = new Set(ticketIds);
    const hasPendingMutation = (ticketId: string) =>
      getBoardEntries(queryClient).some(
        ([, state]) => (state.pendingMutationsByEntityId[ticketId]?.length ?? 0) > 0
      );

    for (const ticket of refs.ticketsByIdRef.current.values()) {
      const update = ticketUpdateMap.get(ticket.id);
      if (!update) {
        if (
          !ticketUpdatesError &&
          ticketUpdates &&
          queriedIds.has(ticket.id) &&
          !hasPendingMutation(ticket.id)
        ) {
          removeTicketFromBoard(ticket.id);
        }
        continue;
      }
      if (!isTicketInScope(update)) {
        removeTicketFromBoard(ticket.id);
        continue;
      }
      const aggregate = aggregateByTicket.get(ticket.id);
      const session = sessionByTicket.get(ticket.id);
      updateTicketInBoards(queryClient, ticket.id, {
        status: update.status ?? ticket.status,
        title: update.title ?? ticket.title,
        is_read: update.is_read ?? ticket.is_read,
        board_position: update.board_position ?? ticket.board_position,
        updated_at: update.updated_at ?? ticket.updated_at,
        latest_objective_agent: aggregate?.latestObjectiveAgent ?? ticket.latest_objective_agent,
        assigned_agent:
          parseObjectiveAssignedAgent(
            (aggregate?.latestAssignedAgent ?? null) as Objective['assigned_agent']
          ) ?? ticket.assigned_agent,
        delegate: update.delegate,
        agent_session_state:
          (session?.session_state as Ticket['agent_session_state']) ??
          ticket.agent_session_state ??
          null,
        running_agent: resolveRunningAgent(aggregate, session),
        has_executing_objective: aggregate?.hasExecutingObjective ?? false,
        objectives_executed_count:
          aggregate?.executedObjectivesCount ?? ticket.objectives_executed_count ?? 0,
        has_draft_objective_with_text: aggregate?.hasDraftObjectiveWithText ?? false
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
    void mergeFetchedTicket(detail.ticketId);
  };

  const handleWaitingOnHumanEvent = (
    event: TicketEvent,
    intent: NonNullable<ReturnType<typeof resolveObjectiveNotificationIntent>>
  ) => {
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

    sendDesktopNotification(intent.title, intent.body);
    playSound(refs.waitingSoundRef.current);
  };

  const handleStatusChangeEvent = (event: TicketEvent) => {
    if (!event.phase) return;
    if (!refs.ticketIdsRef.current.has(event.ticket_id)) return;

    const targetStatus = event.phase;
    const targetType = getBoardEntries(queryClient)
      .map(([, state]) => state.ticketStatusesByName[targetStatus]?.status_type)
      .find(statusType => statusType !== undefined);
    const shouldMoveToTop = targetType === 'review' || targetType === 'complete';
    const existingTicket = refs.ticketsByIdRef.current.get(event.ticket_id);
    updateTicketInBoards(queryClient, event.ticket_id, {
      status: targetStatus,
      board_position:
        shouldMoveToTop && existingTicket
          ? getTopBoardPositionForStatus(
              [...refs.ticketsByIdRef.current.values()],
              targetStatus,
              event.ticket_id
            )
          : existingTicket?.board_position,
      updated_at: event.created_at ?? existingTicket?.updated_at,
      ...(refs.openTicketIdRef.current !== event.ticket_id ? { is_read: false } : {})
    });

    const intent = resolveObjectiveNotificationIntent(event, {
      ticketTitle: existingTicket?.title,
      ticketReference: undefined
    });
    if (!intent || intent.kind !== 'ready_for_review') return;

    playSound(refs.reviewSoundRef.current);
    sendDesktopNotification(intent.title, intent.body);
  };

  const handleAlertEvent = (
    event: TicketEvent,
    intent: NonNullable<ReturnType<typeof resolveObjectiveNotificationIntent>>
  ) => {
    if (!refs.ticketIdsRef.current.has(event.ticket_id)) return;
    sendDesktopNotification(intent.title, intent.body);
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

  let activeChannel: ReturnType<typeof supabase.channel> | null = null;
  let resubscribeTimer: number | null = null;
  let resubscribeAttempt = 0;

  const scheduleResubscribe = () => {
    if (cancelled || resubscribeTimer !== null) return;
    const delay = Math.min(
      RESUBSCRIBE_MAX_DELAY_MS,
      RESUBSCRIBE_BASE_DELAY_MS * 2 ** resubscribeAttempt
    );
    resubscribeAttempt += 1;
    resubscribeTimer = window.setTimeout(() => {
      resubscribeTimer = null;
      subscribeChannel();
    }, delay);
  };

  const subscribeChannel = () => {
    if (cancelled) return;
    if (activeChannel) {
      void supabase.removeChannel(activeChannel);
      activeChannel = null;
    }

    const channel = supabase
      .channel(`tickets-realtime:${organizationId ?? 'all'}:${projectId ?? 'all'}`)
      .on<TicketEvent>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ticket_events' },
        payload => {
          const event = payload.new;
          if (!refs.ticketIdsRef.current.has(event.ticket_id)) return;
          const ticket = refs.ticketsByIdRef.current.get(event.ticket_id);
          const intent = resolveObjectiveNotificationIntent(event, {
            ticketTitle: ticket?.title,
            ticketReference: undefined
          });

          if (isWaitingOnHumanEvent(event) && intent) {
            handleWaitingOnHumanEvent(event, intent);
            return;
          }
          if (event.event_type === 'status_change') {
            handleStatusChangeEvent(event);
            return;
          }
          if (intent?.kind === 'agent_alert') {
            handleAlertEvent(event, intent);
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
            requestObjectiveSync(ticketId);
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
          requestObjectiveSync(changedTicketId);
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
          void mergeFetchedTicket(inserted.id);
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
          if (!refs.ticketIdsRef.current.has(updated.id)) {
            // A ticket moved into this board's scope (e.g. project changed):
            // fetch and merge it like an insert.
            if (isTicketInScope(updated)) {
              void mergeFetchedTicket(updated.id);
            }
            return;
          }
          if (!isTicketInScope(updated)) {
            removeTicketFromBoard(updated.id);
            return;
          }
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
      );

    activeChannel = channel;
    channel.subscribe(status => {
      // Ignore late callbacks from channels we've already replaced.
      if (cancelled || activeChannel !== channel) return;
      if (status === 'SUBSCRIBED') {
        resubscribeAttempt = 0;
        // Catch up on anything that happened before/while (re)joining.
        void syncBoardData();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        void syncBoardData();
        scheduleResubscribe();
      }
    });
  };

  subscribeChannel();

  // Reconcile immediately when the tab wakes up or the network returns —
  // realtime sockets routinely die during sleep/offline and the user should
  // not wait for the next poll tick to see current state.
  const handleWakeUp = () => {
    if (document.visibilityState !== 'visible') return;
    void syncBoardData();
    if (activeChannel && activeChannel.state !== 'joined' && activeChannel.state !== 'joining') {
      scheduleResubscribe();
    }
  };

  window.addEventListener(TICKET_CREATED_EVENT, handleTicketCreated);
  window.addEventListener('storage', handleStorage);
  document.addEventListener('visibilitychange', handleWakeUp);
  window.addEventListener('online', handleWakeUp);

  // Safety net: reconcile periodically so the board never strands on stale
  // state. Skipped while hidden; the wake-up handler covers the catch-up.
  const pollId = window.setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    void syncBoardData();
  }, POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    window.clearInterval(pollId);
    if (resubscribeTimer !== null) window.clearTimeout(resubscribeTimer);
    window.removeEventListener(TICKET_CREATED_EVENT, handleTicketCreated);
    window.removeEventListener('storage', handleStorage);
    document.removeEventListener('visibilitychange', handleWakeUp);
    window.removeEventListener('online', handleWakeUp);
    if (activeChannel) void supabase.removeChannel(activeChannel);
  };
}
