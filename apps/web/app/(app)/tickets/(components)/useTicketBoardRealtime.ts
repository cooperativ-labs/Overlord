'use client';

import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  mergeObjectiveMetaIntoBoards,
  mergeSessionMetaIntoBoards,
  mergeTicketsIntoBoards,
  mergeWaitingQuestionIntoBoards,
  reconcileRealtimeTicketRow,
  removeTicketFromBoards,
  updateTicketInBoards
} from '@/lib/client-data/tickets/cache';
import { parseObjectiveAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import {
  TICKET_DELETED_EVENT,
  type TicketDeletedEventDetail
} from '@/lib/helpers/ticket-board-events';
import {
  getOpenedWaitingTimestamps,
  getWaitingRaisedWhileOpenMap,
  hasUnopenedTimestamp,
  markTicketWaitingRaised,
  type TicketOpenedTimestamps,
  type TicketRaisedWhileOpenMap
} from '@/lib/helpers/ticket-waiting-response';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

import type { Ticket } from './KanbanCard';
import { toBoardTicket } from './ticket-view-helpers';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];
type Objective = Database['public']['Tables']['objectives']['Row'];
type RealtimeBoardTicketRow = {
  id: string;
  title: string | null;
  due_datetime: string | null;
  execution_target: Database['public']['Enums']['ticket_execution_target'];
  status: string;
  priority: string;
  delegate: string | null;
  is_read: boolean;
  updated_at: string;
  board_position: number;
  organization_id: number;
  project_id: string | null;
  everhour_task_id: string | null;
  schedule_id: number | null;
  organization: { name: string } | Array<{ name: string }> | null;
  project:
    | { name: string; color: string; everhour_project_id: string | null }
    | Array<{ name: string; color: string; everhour_project_id: string | null }>
    | null;
};

const WAITING_SOUND_PATH = '/sounds/notification-question.mp3';
const REVIEW_SOUND_PATH = '/sounds/notification-complete.mp3';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getObjectivePayloadTicketId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.ticket_id === 'string' ? value.ticket_id : null;
}

function getSingleRelation<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

function mapRealtimeBoardTicketRow(row: RealtimeBoardTicketRow): Ticket {
  const project = getSingleRelation(row.project);
  const organization = getSingleRelation(row.organization);

  return {
    id: row.id,
    title: row.title,
    objective: null,
    organization_id: row.organization_id,
    project_id: row.project_id,
    project_name: project?.name ?? null,
    project_color: project?.color ?? null,
    project_everhour_project_id: project?.everhour_project_id ?? null,
    everhour_task_id: row.everhour_task_id,
    agent_session_state: null,
    running_agent: null,
    latest_objective_agent: null,
    has_executing_objective: false,
    status: row.status,
    priority: row.priority,
    execution_target: row.execution_target,
    assigned_agent: null,
    board_position: row.board_position,
    organization_name: organization?.name ?? null,
    waiting_for_response_at: null,
    has_unopened_waiting_response: false,
    is_read: row.is_read,
    objectives_executed_count: 0,
    updated_at: row.updated_at,
    delegate: row.delegate,
    schedule_id: row.schedule_id,
    due_datetime: row.due_datetime
  };
}

function getEventMessage(event: TicketEvent): string {
  const summary = event.summary?.trim();
  if (summary) return summary;

  const payload = isRecord(event.payload) ? event.payload : {};
  const payloadMessage = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (payloadMessage) return payloadMessage;

  return 'An agent is waiting for your response.';
}

function toWaitingByTicket(tickets: Ticket[]): Record<string, string> {
  return tickets.reduce<Record<string, string>>((acc, ticket) => {
    if (ticket.waiting_for_response_at) {
      acc[ticket.id] = ticket.waiting_for_response_at;
    }
    return acc;
  }, {});
}

function mergeWaitingByTicket(
  current: Record<string, string>,
  incoming: Ticket[]
): Record<string, string> {
  if (incoming.length === 0) return current;

  const next = { ...current };
  for (const ticket of incoming) {
    if (ticket.waiting_for_response_at) {
      next[ticket.id] = ticket.waiting_for_response_at;
    } else {
      delete next[ticket.id];
    }
  }

  return next;
}

function getTopBoardPositionForStatus(
  tickets: Ticket[],
  status: string,
  excludeTicketId?: string
): number {
  let minBoardPosition = Number.POSITIVE_INFINITY;

  for (const ticket of tickets) {
    if (ticket.status !== status || ticket.id === excludeTicketId) continue;
    minBoardPosition = Math.min(minBoardPosition, ticket.board_position);
  }

  return Number.isFinite(minBoardPosition) ? minBoardPosition - 1 : 0;
}

export function useTicketBoardRealtime({
  tickets,
  organizationId,
  projectId,
  queryClient,
  onTicketRemoved
}: {
  tickets: Ticket[];
  organizationId?: number;
  projectId?: string;
  queryClient: QueryClient;
  onTicketRemoved?: (ticketId: string) => void;
}) {
  const [waitingByTicket, setWaitingByTicket] = useState<Record<string, string>>(() =>
    toWaitingByTicket(tickets)
  );
  const [openedWaitingTimestamps, setOpenedWaitingTimestamps] = useState<TicketOpenedTimestamps>(
    () => getOpenedWaitingTimestamps()
  );
  const [waitingRaisedWhileOpen, setWaitingRaisedWhileOpen] = useState<TicketRaisedWhileOpenMap>(
    () => getWaitingRaisedWhileOpenMap()
  );

  const latestSessionAttachedAtRef = useRef<Map<string, string>>(new Map());
  const waitingSoundRef = useRef<HTMLAudioElement | null>(null);
  const reviewSoundRef = useRef<HTMLAudioElement | null>(null);
  const waitingByTicketRef = useRef(waitingByTicket);
  const openTicketIdRef = useRef<string | null>(null);
  const ticketIdsRef = useRef<Set<string>>(new Set());
  const ticketsByIdRef = useRef<Map<string, Ticket>>(new Map());

  const ticketsWithIndicators = useMemo(
    () =>
      tickets.map(ticket => {
        const waitingForResponseAt =
          waitingByTicket[ticket.id] ?? ticket.waiting_for_response_at ?? null;
        return {
          ...ticket,
          waiting_for_response_at: waitingForResponseAt,
          has_unopened_waiting_response:
            waitingRaisedWhileOpen[ticket.id] === true ||
            hasUnopenedTimestamp(waitingForResponseAt, openedWaitingTimestamps[ticket.id])
        };
      }),
    [openedWaitingTimestamps, tickets, waitingByTicket, waitingRaisedWhileOpen]
  );
  ticketIdsRef.current = new Set(tickets.map(ticket => ticket.id));
  ticketsByIdRef.current = new Map(ticketsWithIndicators.map(ticket => [ticket.id, ticket]));

  const removeTicketFromBoard = useCallback(
    (ticketId: string) => {
      removeTicketFromBoards(queryClient, ticketId);
      setWaitingByTicket(prev => {
        if (!(ticketId in prev)) return prev;
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });
      latestSessionAttachedAtRef.current.delete(ticketId);
      onTicketRemoved?.(ticketId);
    },
    [onTicketRemoved, queryClient]
  );

  useEffect(() => {
    waitingByTicketRef.current = waitingByTicket;
  }, [waitingByTicket]);

  useEffect(() => {
    const handleTicketDeleted = (event: Event) => {
      const ticketId = (event as CustomEvent<TicketDeletedEventDetail>).detail?.ticketId;
      if (!ticketId) return;
      removeTicketFromBoard(ticketId);
    };

    window.addEventListener(TICKET_DELETED_EVENT, handleTicketDeleted);
    return () => window.removeEventListener(TICKET_DELETED_EVENT, handleTicketDeleted);
  }, [removeTicketFromBoard]);

  useEffect(() => {
    const waitingAudio = new Audio(WAITING_SOUND_PATH);
    waitingAudio.preload = 'auto';
    waitingSoundRef.current = waitingAudio;

    const reviewAudio = new Audio(REVIEW_SOUND_PATH);
    reviewAudio.preload = 'auto';
    reviewSoundRef.current = reviewAudio;

    return () => {
      waitingSoundRef.current = null;
      reviewSoundRef.current = null;
    };
  }, []);

  useEffect(() => {
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

    const applySessionOverride = (
      session: Pick<AgentSession, 'ticket_id' | 'session_state' | 'agent_identifier'>
    ) => {
      const isAttached = session.session_state === 'attached';
      updateTicketInBoards(queryClient, session.ticket_id, {
        agent_session_state: session.session_state,
        running_agent: isAttached ? session.agent_identifier : null
      });
    };

    const syncObjectiveStateForTicket = async (ticketId: string) => {
      const [{ data: objectives }, { data: sessions }] = await Promise.all([
        supabase
          .from('objectives')
          .select('state,agent_identifier,assigned_agent')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: false }),
        supabase
          .from('agent_sessions')
          .select('session_state,agent_identifier,attached_at')
          .eq('ticket_id', ticketId)
          .order('attached_at', { ascending: false })
          .limit(1)
      ]);

      if (cancelled || !ticketIdsRef.current.has(ticketId)) return;

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
      mergeObjectiveMetaIntoBoards(queryClient, ticketId, {
        latest_agent: latestObjectiveAgent,
        executing_agent: executingObjectiveAgent
      });
    };

    const syncBoardData = async () => {
      const ticketIds = [...ticketIdsRef.current];
      if (ticketIds.length === 0) return;

      const [
        { data: sessions },
        { data: waitingQuestions },
        { data: ticketUpdates },
        { data: objectives }
      ] = await Promise.all([
        supabase
          .from('agent_sessions')
          .select('ticket_id,session_state,agent_identifier,attached_at')
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
      for (const session of (sessions ?? []) as Pick<
        AgentSession,
        'ticket_id' | 'session_state' | 'agent_identifier'
      >[]) {
        if (!sessionByTicket.has(session.ticket_id)) {
          sessionByTicket.set(session.ticket_id, session);
        }
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

      for (const ticket of ticketsByIdRef.current.values()) {
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
        mergeObjectiveMetaIntoBoards(queryClient, ticket.id, {
          latest_agent:
            latestObjectiveAgentByTicket.get(ticket.id) ?? ticket.latest_objective_agent ?? null,
          executing_agent: executingObjectiveAgentByTicket.get(ticket.id) ?? null
        });
      }

      const nextWaitingByTicket = { ...waitingByTicketRef.current };
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
        setWaitingByTicket(nextWaitingByTicket);
        for (const ticketId of raisedWaitingTicketIds) {
          markTicketWaitingRaised(ticketId, openTicketIdRef.current === ticketId);
        }
        setOpenedWaitingTimestamps(getOpenedWaitingTimestamps());
        setWaitingRaisedWhileOpen(getWaitingRaisedWhileOpenMap());
      }
    };

    const handleQuestionEvent = (event: TicketEvent) => {
      if (!event.is_blocking) return;
      if (!ticketIdsRef.current.has(event.ticket_id)) return;
      mergeWaitingQuestionIntoBoards(queryClient, event);

      setWaitingByTicket(previous => {
        const existing = previous[event.ticket_id];
        if (existing && Date.parse(existing) >= Date.parse(event.created_at)) {
          return previous;
        }
        return { ...previous, [event.ticket_id]: event.created_at };
      });
      markTicketWaitingRaised(event.ticket_id, openTicketIdRef.current === event.ticket_id);
      setOpenedWaitingTimestamps(getOpenedWaitingTimestamps());
      setWaitingRaisedWhileOpen(getWaitingRaisedWhileOpenMap());

      const ticket = ticketsByIdRef.current.get(event.ticket_id);
      const title = ticket?.title?.trim()
        ? `Agent waiting: ${ticket.title.trim()}`
        : 'Agent waiting for response';

      void window.electronAPI?.app?.notify(title, getEventMessage(event));

      const waitingSound = waitingSoundRef.current;
      if (waitingSound) {
        waitingSound.currentTime = 0;
        void waitingSound.play().catch(() => undefined);
      }
    };

    const handleStatusChangeEvent = (event: TicketEvent) => {
      if (!event.phase) return;
      if (!ticketIdsRef.current.has(event.ticket_id)) return;

      const shouldMoveToTopOfReview = event.phase === 'review' && event.session_id !== null;
      const existingTicket = ticketsByIdRef.current.get(event.ticket_id);
      updateTicketInBoards(queryClient, event.ticket_id, {
        status: event.phase,
        board_position:
          shouldMoveToTopOfReview && existingTicket
            ? getTopBoardPositionForStatus(
                [...ticketsByIdRef.current.values()],
                event.phase,
                event.ticket_id
              )
            : existingTicket?.board_position,
        updated_at: event.created_at ?? existingTicket?.updated_at,
        ...(openTicketIdRef.current !== event.ticket_id ? { is_read: false } : {})
      });

      if (event.phase !== 'review') return;

      const reviewSound = reviewSoundRef.current;
      if (reviewSound) {
        reviewSound.currentTime = 0;
        void reviewSound.play().catch(() => undefined);
      }

      const reviewTicket = ticketsByIdRef.current.get(event.ticket_id);
      const reviewTitle = reviewTicket?.title?.trim()
        ? `Ready for review: ${reviewTicket.title.trim()}`
        : 'Ticket moved to review';
      void window.electronAPI?.app?.notify(reviewTitle, 'The agent has delivered this ticket.');
    };

    // Use a stable channel name (no ticket-set size) so the channel survives
    // ticket additions/removals — otherwise we tear down and rebuild on every
    // ticket-set change and miss INSERTs during the gap.
    let channel = supabase.channel(
      `tickets-realtime:${organizationId ?? 'all'}:${projectId ?? 'all'}`
    );

    // Subscribe once at the schema level for ticket_events / agent_sessions /
    // objectives instead of attaching one filtered listener per ticket.
    // Per-ticket filters scaled linearly with the visible ticket count and hit
    // Supabase Realtime's per-channel filter limits, dropping events silently
    // under load. RLS still gates row visibility; we filter to the visible
    // ticket set client-side via ticketIdsRef.
    channel = channel
      .on<TicketEvent>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ticket_events' },
        payload => {
          const event = payload.new;
          if (!ticketIdsRef.current.has(event.ticket_id)) return;
          if (event.event_type === 'question') {
            handleQuestionEvent(event);
            return;
          }
          if (event.event_type === 'status_change') {
            handleStatusChangeEvent(event);
          }
        }
      )
      .on<AgentSession>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'agent_sessions' },
        payload => {
          const session = payload.new;
          if (!ticketIdsRef.current.has(session.ticket_id)) return;
          latestSessionAttachedAtRef.current.set(session.ticket_id, session.attached_at);
          mergeSessionMetaIntoBoards(queryClient, session.ticket_id, {
            session_state: session.session_state,
            agent_identifier: session.agent_identifier,
            attached_at: session.attached_at
          });
          applySessionOverride(session);
        }
      )
      .on<AgentSession>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'agent_sessions' },
        payload => {
          const session = payload.new;
          if (!ticketIdsRef.current.has(session.ticket_id)) return;
          const latestAt = latestSessionAttachedAtRef.current.get(session.ticket_id) ?? '';
          if (session.attached_at < latestAt) return;
          mergeSessionMetaIntoBoards(queryClient, session.ticket_id, {
            session_state: session.session_state,
            agent_identifier: session.agent_identifier,
            attached_at: session.attached_at
          });
          applySessionOverride(session);
        }
      )
      .on<Objective>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'objectives' },
        payload => {
          const changedTicketId =
            getObjectivePayloadTicketId(payload.new) ?? getObjectivePayloadTicketId(payload.old);
          if (!changedTicketId) return;
          if (!ticketIdsRef.current.has(changedTicketId)) return;
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
            setWaitingByTicket(previous => mergeWaitingByTicket(previous, [ticket]));
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
          if (!ticketIdsRef.current.has(updated.id)) return;
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
          if (!deletedId || !ticketIdsRef.current.has(deletedId)) return;
          removeTicketFromBoard(deletedId);
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          void syncBoardData();
        }
      });

    // Safety net: even when the channel reports SUBSCRIBED, Realtime can
    // silently drop events (e.g. transient backend hiccups, network proxies,
    // sleeping tabs). Reconcile every 30s so the board never strands on a
    // stale state for more than that long.
    const pollId = window.setInterval(() => {
      void syncBoardData();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [organizationId, projectId, queryClient, removeTicketFromBoard]);

  const mergeWaitingFromLoadedTickets = useCallback((incoming: Ticket[]) => {
    if (incoming.length === 0) return;
    setWaitingByTicket(prev => mergeWaitingByTicket(prev, incoming));
  }, []);

  return {
    ticketsWithIndicators,
    waitingByTicket,
    openedWaitingTimestamps,
    waitingRaisedWhileOpen,
    setOpenedWaitingTimestamps,
    setWaitingRaisedWhileOpen,
    openTicketIdRef,
    ticketIdsRef,
    ticketsByIdRef,
    removeTicketFromBoard,
    mergeWaitingFromLoadedTickets
  };
}
