'use client';

import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { upsertProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import {
  createTicketInColumnAction,
  loadMoreTicketsAction,
  markTicketReadAction,
  markTicketsReadAction,
  markTicketUnreadAction,
  reorderTicketsAction
} from '@/lib/actions/tickets';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import {
  getOpenedWaitingTimestamps,
  getWaitingRaisedWhileOpenMap,
  hasUnopenedTimestamp,
  markTicketWaitingOpened,
  markTicketWaitingRaised,
  markTicketWaitingUnread,
  type TicketOpenedTimestamps,
  type TicketRaisedWhileOpenMap
} from '@/lib/helpers/ticket-waiting-response';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

import KanbanBoardToolbar from './KanbanBoardToolbar';
import KanbanCard, { type Ticket } from './KanbanCard';
import KanbanColumn from './KanbanColumn';

const UNCATEGORIZED_COLUMN_ID = '__uncategorized';
const WAITING_SOUND_PATH = '/sounds/notification-question.mp3';
const REVIEW_SOUND_PATH = '/sounds/notification-complete.mp3';
const EMPTY_FILE_MENTION_PATHS: string[] = [];
const USER_HIDDEN_COLUMNS_KEY = 'overlord:user-board:hidden-columns';
const TICKETS_PAGE_SIZE = 20;

type StatusColumn = {
  id: string;
  title: string;
  position: number;
  statusType?: string;
};

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];

import { formatStatusLabel, getPathTicketId } from './ticket-view-helpers';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function mergeTicketsById(current: Ticket[], incoming: Ticket[]): Ticket[] {
  if (incoming.length === 0) return current;

  const incomingById = new Map(incoming.map(ticket => [ticket.id, ticket]));
  const seen = new Set<string>();
  const merged = current.map(ticket => {
    const next = incomingById.get(ticket.id);
    if (!next) return ticket;
    seen.add(ticket.id);
    return { ...ticket, ...next };
  });

  for (const ticket of incoming) {
    if (!seen.has(ticket.id)) {
      merged.push(ticket);
    }
  }

  return merged;
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

export default function KanbanBoard({
  tickets: initialTickets,
  statuses,
  showOrganizationName = false,
  organizationId,
  projectId,
  fileMentionPaths = EMPTY_FILE_MENTION_PATHS,
  workingDirectory = null,
  initialView,
  initialHiddenColumns = []
}: {
  tickets: Ticket[];
  statuses: Array<{ name: string; position: number; status_type?: string }>;
  showOrganizationName?: boolean;
  organizationId?: number;
  projectId?: string;
  fileMentionPaths?: string[];
  workingDirectory?: string | null;
  initialView: string;
  initialHiddenColumns?: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const projectSettings = useProjectSettings();
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [filteredProjectId, setFilteredProjectId] = useState<string | null>(null);
  const [waitingByTicket, setWaitingByTicket] = useState<Record<string, string>>(() =>
    toWaitingByTicket(initialTickets)
  );
  const [openedWaitingTimestamps, setOpenedWaitingTimestamps] = useState<TicketOpenedTimestamps>(
    () => getOpenedWaitingTimestamps()
  );
  const [waitingRaisedWhileOpen, setWaitingRaisedWhileOpen] = useState<TicketRaisedWhileOpenMap>(
    () => getWaitingRaisedWhileOpenMap()
  );

  // Single source of truth for ticket data after mount.
  // Seeded from server props, updated directly by real-time events, polling, and user actions.
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  // Tracks the column a card is being dragged into, for immediate synchronous
  // re-render of SortableContext items (shows the insertion gap in the target column).
  const [activeDragStatus, setActiveDragStatus] = useState<{
    ticketId: string;
    status: string;
  } | null>(null);
  const latestSessionAttachedAtRef = useRef<Map<string, string>>(new Map());

  const waitingSoundRef = useRef<HTMLAudioElement | null>(null);
  const reviewSoundRef = useRef<HTMLAudioElement | null>(null);
  const waitingByTicketRef = useRef(waitingByTicket);
  const openTicketIdRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollKey = `kanban-scroll:${projectId ?? organizationId ?? 'default'}`;
  const boardScopeKey = `${organizationId ?? 'all'}:${projectId ?? 'all'}`;
  const previousBoardScopeKeyRef = useRef(boardScopeKey);

  useEffect(() => {
    waitingByTicketRef.current = waitingByTicket;
  }, [waitingByTicket]);

  // Reconcile when server delivers new data (navigation, router.refresh()).
  useEffect(() => {
    if (previousBoardScopeKeyRef.current !== boardScopeKey) {
      previousBoardScopeKeyRef.current = boardScopeKey;
      setTickets(initialTickets);
      setWaitingByTicket(toWaitingByTicket(initialTickets));
      return;
    }

    setTickets(previous => mergeTicketsById(previous, initialTickets));
    setWaitingByTicket(previous => mergeWaitingByTicket(previous, initialTickets));
  }, [boardScopeKey, initialTickets]);

  // Restore x-scroll position after remount (e.g. when opening a ticket reloads the board)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const saved = sessionStorage.getItem(scrollKey);
    if (saved) container.scrollLeft = parseInt(saved, 10);
  }, [scrollKey]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) sessionStorage.setItem(scrollKey, String(container.scrollLeft));
  }, [scrollKey]);

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

  const columns: StatusColumn[] = statuses.map(status => ({
    id: status.name,
    title: formatStatusLabel(status.name),
    position: status.position,
    statusType: status.status_type
  }));

  const allColumnSlugs = columns.map(c => c.id);
  const [visibleSlugs, setVisibleSlugs] = useState<Set<string>>(() => {
    let hidden = initialHiddenColumns;
    if (!projectId && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(USER_HIDDEN_COLUMNS_KEY);
        if (stored) hidden = JSON.parse(stored) as string[];
      } catch {
        // ignore malformed localStorage
      }
    }
    const hiddenSet = new Set(hidden);
    return new Set(allColumnSlugs.filter(slug => !hiddenSet.has(slug)));
  });
  type ColumnLoadMoreState = { cutoff: string; hasMore: boolean; isLoading: boolean };
  const [columnLoadMoreStates, setColumnLoadMoreStates] = useState<
    Map<string, ColumnLoadMoreState>
  >(() => new Map());

  // Apply the in-flight drag column override so the target column's SortableContext
  // includes the dragged card immediately (no startTransition deferral).
  const dragAdjustedTickets = activeDragStatus
    ? tickets.map(t =>
        t.id === activeDragStatus.ticketId ? { ...t, status: activeDragStatus.status } : t
      )
    : tickets;

  const ticketsWithIndicators = dragAdjustedTickets.map(ticket => {
    const waitingForResponseAt =
      waitingByTicket[ticket.id] ?? ticket.waiting_for_response_at ?? null;
    return {
      ...ticket,
      waiting_for_response_at: waitingForResponseAt,
      has_unopened_waiting_response:
        waitingRaisedWhileOpen[ticket.id] === true ||
        hasUnopenedTimestamp(waitingForResponseAt, openedWaitingTimestamps[ticket.id])
    };
  });

  // Keep a mutable ref for the working ticket list during drag
  const workingTickets = useRef(dragAdjustedTickets);
  workingTickets.current = dragAdjustedTickets;

  const ticketIdsRef = useRef<Set<string>>(new Set());
  ticketIdsRef.current = new Set(tickets.map(ticket => ticket.id));

  const ticketsByIdRef = useRef<Map<string, Ticket>>(new Map());
  ticketsByIdRef.current = new Map(ticketsWithIndicators.map(ticket => [ticket.id, ticket]));

  // Derive unique projects for the project filter (only relevant on all-tasks views)
  const projectOptions = useMemo(() => {
    if (projectId) return [];
    const seen = new Map<string, { id: string; name: string; color: string | null }>();
    for (const ticket of tickets) {
      if (!seen.has(ticket.project_id)) {
        seen.set(ticket.project_id, {
          id: ticket.project_id,
          name: ticket.project_name ?? ticket.project_id,
          color: ticket.project_color ?? null
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [projectId, tickets]);

  const displayedTickets = useMemo(
    () =>
      filteredProjectId
        ? ticketsWithIndicators.filter(t => t.project_id === filteredProjectId)
        : ticketsWithIndicators,
    [filteredProjectId, ticketsWithIndicators]
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position),
    [columns]
  );

  const columnById = useMemo(() => new Map(columns.map(c => [c.id, c])), [columns]);
  const initialHasMoreByColumn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ticket of initialTickets) {
      counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1);
    }
    return counts;
  }, [initialTickets]);

  const groupTickets = useCallback(
    (ticketList: Ticket[]) => {
      const groups = new Map<string, Ticket[]>();
      const uncategorized: Ticket[] = [];
      const getUpdatedAtMs = (ticket: Ticket) => {
        const value = ticket.updated_at ? Date.parse(ticket.updated_at) : Number.NaN;
        return Number.isNaN(value) ? -1 : value;
      };

      for (const col of sortedColumns) {
        groups.set(col.id, []);
      }

      for (const ticket of ticketList) {
        if (groups.has(ticket.status)) {
          groups.get(ticket.status)!.push(ticket);
        } else {
          uncategorized.push(ticket);
        }
      }

      for (const [slug, colTickets] of groups) {
        if (!visibleSlugs.has(slug)) {
          continue;
        }
        const isCompleteColumn = columnById.get(slug)?.statusType === 'complete';
        if (isCompleteColumn) {
          colTickets.sort((a, b) => {
            const updatedAtDiff = getUpdatedAtMs(b) - getUpdatedAtMs(a);
            if (updatedAtDiff !== 0) return updatedAtDiff;
            return a.board_position - b.board_position;
          });
        } else {
          colTickets.sort((a, b) => a.board_position - b.board_position);
        }
      }

      uncategorized.sort((a, b) => a.board_position - b.board_position);

      return { groups, uncategorized };
    },
    [columnById, sortedColumns, visibleSlugs]
  );

  const { groups: columnTickets, uncategorized } = useMemo(
    () => groupTickets(displayedTickets),
    [displayedTickets, groupTickets]
  );

  function handleMarkColumnRead(ticketIds: string[]) {
    const now = Date.now();
    const unreadIds: string[] = [];
    for (const id of ticketIds) {
      const ticket = ticketsByIdRef.current.get(id);
      if (!ticket) continue;
      if (waitingByTicket[id] ?? ticket.waiting_for_response_at) {
        markTicketWaitingOpened(id, now);
      }
      if (ticket.is_read === false) {
        unreadIds.push(id);
      }
    }
    if (unreadIds.length > 0) {
      const unreadSet = new Set(unreadIds);
      setTickets(prev => prev.map(t => (unreadSet.has(t.id) ? { ...t, is_read: true } : t)));
      startTransition(() => markTicketsReadAction(unreadIds));
    }
    setOpenedWaitingTimestamps(getOpenedWaitingTimestamps());
    setWaitingRaisedWhileOpen(getWaitingRaisedWhileOpenMap());
  }

  function handleMarkUnread(ticketId: string) {
    const ticket = ticketsByIdRef.current.get(ticketId);
    if (!ticket) return;

    if (ticket.waiting_for_response_at) {
      setOpenedWaitingTimestamps(markTicketWaitingUnread(ticketId));
      setWaitingRaisedWhileOpen(getWaitingRaisedWhileOpenMap());
    }

    setTickets(prev => prev.map(t => (t.id === ticketId ? { ...t, is_read: false } : t)));
    startTransition(() => markTicketUnreadAction(ticketId));
  }

  function handleMarkRead(ticketId: string) {
    const ticket = ticketsByIdRef.current.get(ticketId);
    if (!ticket) return;

    setTickets(prev => prev.map(t => (t.id === ticketId ? { ...t, is_read: true } : t)));
    startTransition(() => markTicketReadAction(ticketId));
  }

  async function handleLoadMore(columnId: string) {
    const state = columnLoadMoreStates.get(columnId);
    if (state?.isLoading || state?.hasMore === false) return;

    // Derive initial cursor from the oldest updated_at in the column's current tickets
    const colTickets = columnTickets.get(columnId) ?? [];
    const colOldestUpdatedAt =
      colTickets
        .map(t => t.updated_at)
        .filter(Boolean)
        .sort()[0] ?? new Date().toISOString();

    const cutoff = state?.cutoff ?? colOldestUpdatedAt;

    setColumnLoadMoreStates(prev => {
      const next = new Map(prev);
      next.set(columnId, { cutoff, hasMore: true, isLoading: true });
      return next;
    });

    try {
      const { tickets: loaded } = await loadMoreTicketsAction({
        status: columnId,
        organizationId,
        projectId,
        beforeDate: cutoff
      });

      // Next cursor is the oldest updated_at in this batch
      const newCutoff =
        loaded.length > 0 ? (loaded[loaded.length - 1].updated_at ?? cutoff) : cutoff;

      setTickets(prev => mergeTicketsById(prev, loaded as Ticket[]));
      setWaitingByTicket(prev => mergeWaitingByTicket(prev, loaded as Ticket[]));
      setColumnLoadMoreStates(prev => {
        const next = new Map(prev);
        next.set(columnId, {
          cutoff: newCutoff,
          hasMore: loaded.length === TICKETS_PAGE_SIZE,
          isLoading: false
        });
        return next;
      });
    } catch {
      setColumnLoadMoreStates(prev => {
        const next = new Map(prev);
        const existing = prev.get(columnId);
        next.set(columnId, { cutoff, hasMore: true, isLoading: false, ...existing });
        return next;
      });
    }
  }

  useEffect(() => {
    if (uncategorized.length > 0) {
      setVisibleSlugs(prev =>
        prev.has(UNCATEGORIZED_COLUMN_ID) ? prev : new Set(prev).add(UNCATEGORIZED_COLUMN_ID)
      );
    }
  }, [uncategorized.length]);

  useEffect(() => {
    const pathTicketId = getPathTicketId(pathname);
    if (pathTicketId && ticketIdsRef.current.has(pathTicketId)) {
      openTicketIdRef.current = pathTicketId;
    } else {
      openTicketIdRef.current = null;
    }

    if (!pathTicketId || !ticketIdsRef.current.has(pathTicketId)) {
      return;
    }

    setOpenedWaitingTimestamps(markTicketWaitingOpened(pathTicketId));
    setWaitingRaisedWhileOpen(getWaitingRaisedWhileOpenMap());

    // Mark the ticket as read when the user navigates to it.
    const ticket = ticketsByIdRef.current.get(pathTicketId);
    if (ticket?.is_read === false) {
      setTickets(prev => prev.map(t => (t.id === pathTicketId ? { ...t, is_read: true } : t)));
      startTransition(() => markTicketReadAction(pathTicketId));
    }
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const applySessionOverride = (
      session: Pick<AgentSession, 'ticket_id' | 'session_state' | 'agent_identifier'>
    ) => {
      const isAttached = session.session_state === 'attached';
      setTickets(prev =>
        prev.map(t => {
          if (t.id !== session.ticket_id) return t;
          return {
            ...t,
            agent_session_state: session.session_state,
            running_agent: isAttached ? session.agent_identifier : null,
            ...(!isAttached ? { recent_agent: session.agent_identifier } : {})
          };
        })
      );
    };

    const syncBoardData = async () => {
      const ticketIds = [...ticketIdsRef.current];
      if (ticketIds.length === 0) return;

      const [{ data: sessions }, { data: waitingQuestions }, { data: ticketUpdates }] =
        await Promise.all([
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
            .select('id,status,title,recent_agent,is_read,board_position,updated_at')
            .in('id', ticketIds)
        ]);

      if (cancelled) return;

      const sessionByTicket = new Map<
        string,
        Pick<AgentSession, 'session_state' | 'agent_identifier'>
      >();
      for (const s of (sessions ?? []) as Pick<
        AgentSession,
        'ticket_id' | 'session_state' | 'agent_identifier'
      >[]) {
        if (!sessionByTicket.has(s.ticket_id)) {
          sessionByTicket.set(s.ticket_id, s);
        }
      }

      const ticketUpdateMap = new Map(
        (
          (ticketUpdates ?? []) as Array<{
            id: string;
            status: string | null;
            title: string | null;
            recent_agent: string | null;
            is_read: boolean;
            board_position: number;
            updated_at: string;
          }>
        ).map(t => [t.id, t])
      );

      setTickets(prev =>
        prev.map(t => {
          const update = ticketUpdateMap.get(t.id);
          if (!update) return t;
          const session = sessionByTicket.get(t.id);
          const isAttached = session?.session_state === 'attached';
          return {
            ...t,
            status: update.status ?? t.status,
            title: update.title ?? t.title,
            is_read: update.is_read ?? t.is_read,
            board_position: update.board_position ?? t.board_position,
            updated_at: update.updated_at ?? t.updated_at,
            recent_agent: update.recent_agent ?? t.recent_agent,
            ...(session
              ? {
                  agent_session_state: session.session_state,
                  running_agent: isAttached ? session.agent_identifier : null,
                  ...(!isAttached ? { recent_agent: session.agent_identifier } : {})
                }
              : {})
          };
        })
      );

      const nextWaitingByTicket = { ...waitingByTicketRef.current };
      const raisedWaitingTicketIds: string[] = [];
      let waitingChanged = false;
      for (const q of (waitingQuestions ?? []) as { ticket_id: string; created_at: string }[]) {
        if (
          !nextWaitingByTicket[q.ticket_id] ||
          Date.parse(q.created_at) > Date.parse(nextWaitingByTicket[q.ticket_id])
        ) {
          nextWaitingByTicket[q.ticket_id] = q.created_at;
          raisedWaitingTicketIds.push(q.ticket_id);
          waitingChanged = true;
        }
      }
      if (waitingChanged) {
        setWaitingByTicket(nextWaitingByTicket);
        for (const ticketId of raisedWaitingTicketIds) {
          const isTicketOpen = openTicketIdRef.current === ticketId;
          markTicketWaitingRaised(ticketId, isTicketOpen);
        }
        setOpenedWaitingTimestamps(getOpenedWaitingTimestamps());
        setWaitingRaisedWhileOpen(getWaitingRaisedWhileOpenMap());
      }
    };

    const channel = supabase
      .channel(`kanban-realtime:${organizationId ?? 'all'}:${projectId ?? 'all'}`)
      .on<TicketEvent>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ticket_events',
          filter: 'event_type=eq.question'
        },
        payload => {
          const event = payload.new;
          if (!event.is_blocking) return;
          if (!ticketIdsRef.current.has(event.ticket_id)) return;

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
        }
      )
      .on<TicketEvent>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ticket_events',
          filter: 'event_type=eq.status_change'
        },
        payload => {
          const event = payload.new;
          if (!event.phase) return;
          if (!ticketIdsRef.current.has(event.ticket_id)) return;

          const shouldMoveToTopOfReview = event.phase === 'review' && event.session_id !== null;

          // Move the card to the target column and mark unread.
          // This is the authoritative signal — it fires after the ticket row
          // has been committed, so it is reliable even when the tickets UPDATE
          // real-time event is missed (e.g. due to after() timing on Vercel).
          setTickets(prev =>
            prev.map(t => {
              if (t.id !== event.ticket_id) return t;
              return {
                ...t,
                status: event.phase!,
                board_position: shouldMoveToTopOfReview
                  ? getTopBoardPositionForStatus(prev, event.phase!, event.ticket_id)
                  : t.board_position,
                updated_at: event.created_at ?? t.updated_at,
                ...(openTicketIdRef.current !== event.ticket_id ? { is_read: false } : {})
              };
            })
          );

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
          setTickets(prev =>
            prev.map(t => {
              if (t.id !== updated.id) return t;
              return {
                ...t,
                status: updated.status ?? t.status,
                title: updated.title ?? t.title,
                is_read: updated.is_read ?? t.is_read,
                board_position: updated.board_position ?? t.board_position,
                updated_at: updated.updated_at ?? t.updated_at
              };
            })
          );
        }
      )
      .on<AgentSession>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'agent_sessions' },
        payload => {
          const session = payload.new;
          if (!ticketIdsRef.current.has(session.ticket_id)) return;
          latestSessionAttachedAtRef.current.set(session.ticket_id, session.attached_at);
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
          applySessionOverride(session);
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          void syncBoardData();
        }
      });

    const pollId = window.setInterval(() => {
      void syncBoardData();
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [organizationId, projectId]);

  const toggleColumnVisibility = (slug: string) => {
    setVisibleSlugs(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);

      const hiddenColumns = allColumnSlugs.filter(s => !next.has(s));

      if (projectId) {
        startTransition(() => {
          void upsertProjectUserPreferencesAction(projectId, { hidden_columns: hiddenColumns });
        });
      } else {
        try {
          localStorage.setItem(USER_HIDDEN_COLUMNS_KEY, JSON.stringify(hiddenColumns));
        } catch {
          // ignore localStorage errors (quota, private browsing)
        }
      }

      return next;
    });
  };

  const visibleSortedColumns = sortedColumns.filter(col => visibleSlugs.has(col.id));
  const showUncategorized = uncategorized.length > 0 && visibleSlugs.has(UNCATEGORIZED_COLUMN_ID);

  function findColumnSlug(ticketId: string): string | undefined {
    const ticket = workingTickets.current.find(t => t.id === ticketId);
    if (!ticket) return undefined;
    return ticket.status;
  }

  function resolveOverColumn(overId: string): string | undefined {
    if (columnById.has(overId)) return overId;
    return findColumnSlug(overId);
  }

  function handleDragStart(event: DragStartEvent) {
    const ticket = ticketsByIdRef.current.get(event.active.id as string) ?? null;
    setActiveTicket(ticket);
    if (ticket) setActiveDragStatus({ ticketId: ticket.id, status: ticket.status });
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeSlug = findColumnSlug(active.id as string);
    const overSlug = resolveOverColumn(over.id as string);
    if (!activeSlug || !overSlug || activeSlug === overSlug) return;

    const targetColumn = columnById.get(overSlug);
    if (!targetColumn) return;

    // Synchronous state update (no startTransition) so the target column's
    // SortableContext items include the dragged card on the very next render,
    // giving the user the drop-position preview gap.
    setActiveDragStatus({ ticketId: active.id as string, status: targetColumn.id });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTicket(null);

    const { active, over } = event;

    // Capture the last drag position from the ref BEFORE clearing activeDragStatus.
    // React batches state updates so workingTickets.current still holds the
    // drag-adjusted value (from the last render) for the rest of this handler.
    const snapshot = workingTickets.current;

    // Clear drag-over state regardless of whether the drop is valid.
    setActiveDragStatus(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const columnSlug = resolveOverColumn(overId) ?? findColumnSlug(activeId);
    if (!columnSlug) return;

    const originalSlug = tickets.find(t => t.id === activeId)?.status;
    const statusChanged = originalSlug !== undefined && originalSlug !== columnSlug;

    // Use the captured snapshot (which includes the drag-adjusted status) so that
    // groupTickets places the card in the correct column even if activeDragStatus
    // has just been cleared above (the re-render hasn't happened yet).
    const effectiveTickets = statusChanged
      ? snapshot.map(t => (t.id === activeId ? { ...t, status: columnSlug } : t))
      : snapshot;

    if (!effectiveTickets.find(t => t.id === activeId)) return;

    const { groups } = groupTickets(effectiveTickets);
    const colTickets = groups.get(columnSlug) ?? [];

    const oldIndex = colTickets.findIndex(t => t.id === activeId);
    const newIndex = colTickets.findIndex(t => t.id === overId);

    let reordered = colTickets;
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      reordered = arrayMove(colTickets, oldIndex, newIndex);
    }

    const orderedIds = reordered.map(t => t.id);
    const col = columnById.get(columnSlug);

    // Update tickets state directly with new positions and status.
    const positionMap = new Map(orderedIds.map((id, i) => [id, i]));
    setTickets(prev =>
      prev.map(t => {
        let next = t;
        if (positionMap.has(t.id)) next = { ...next, board_position: positionMap.get(t.id)! };
        if (statusChanged && t.id === activeId && col) next = { ...next, status: col.id };
        return next;
      })
    );

    startTransition(async () => {
      await reorderTicketsAction(
        orderedIds,
        statusChanged && col ? { ticketId: activeId, newStatus: col.id } : undefined
      );

      // Ensure the router fetches fresh server-state after the action so the
      // board reflects the new position/status even when the Supabase realtime
      // subscription is unavailable (e.g. Electron with a restrictive CSP).
      router.refresh();
    });
  }

  async function handleCreateTicket(
    status: string,
    objective: string,
    position: 'top' | 'bottom' = 'top'
  ) {
    const trimmedObjective = objective.trim();
    if (!trimmedObjective) {
      return;
    }
    const clientTicketId = crypto.randomUUID();

    const previous = workingTickets.current;
    const columnTicketsForStatus = previous.filter(ticket => ticket.status === status);
    const positionInColumn =
      columnTicketsForStatus.length > 0
        ? position === 'bottom'
          ? columnTicketsForStatus.reduce(
              (max, ticket) => Math.max(max, ticket.board_position),
              -Infinity
            ) + 1
          : columnTicketsForStatus.reduce(
              (min, ticket) => Math.min(min, ticket.board_position),
              Infinity
            ) - 1
        : 0;

    const referenceTicket =
      previous.find(ticket => (projectId ? ticket.project_id === projectId : true)) ?? previous[0];

    const optimisticTicket: Ticket = {
      id: clientTicketId,
      title: deriveTitleFromObjective(trimmedObjective),
      objective: trimmedObjective,
      organization_id: organizationId ?? referenceTicket?.organization_id ?? 0,
      project_id: projectId ?? referenceTicket?.project_id ?? '',
      project_name: referenceTicket?.project_name ?? null,
      project_color: referenceTicket?.project_color ?? null,
      project_everhour_project_id: referenceTicket?.project_everhour_project_id ?? null,
      everhour_task_id: null,
      agent_session_state: null,
      status,
      priority: 'medium',
      execution_target: 'agent',
      assigned_agent: null,
      board_position: positionInColumn,
      organization_name: referenceTicket?.organization_name ?? null,
      waiting_for_response_at: null,
      has_unopened_waiting_response: false,
      is_read: true
    };

    setTickets(prev => [...prev, optimisticTicket]);

    try {
      await createTicketInColumnAction(
        status,
        trimmedObjective,
        clientTicketId,
        organizationId,
        projectId,
        position
      );
    } catch {
      setTickets(prev => prev.filter(t => t.id !== clientTicketId));
    }
  }

  async function handleCreateAndOpenTicket(
    status: string,
    objective: string,
    position: 'top' | 'bottom' = 'top'
  ) {
    const trimmedObjective = objective.trim();
    if (!trimmedObjective) return;
    const clientTicketId = crypto.randomUUID();

    const previous = workingTickets.current;
    const columnTicketsForStatus = previous.filter(ticket => ticket.status === status);
    const positionInColumn =
      columnTicketsForStatus.length > 0
        ? position === 'bottom'
          ? columnTicketsForStatus.reduce(
              (max, ticket) => Math.max(max, ticket.board_position),
              -Infinity
            ) + 1
          : columnTicketsForStatus.reduce(
              (min, ticket) => Math.min(min, ticket.board_position),
              Infinity
            ) - 1
        : 0;

    const referenceTicket =
      previous.find(ticket => (projectId ? ticket.project_id === projectId : true)) ?? previous[0];

    const optimisticTicket: Ticket = {
      id: clientTicketId,
      title: deriveTitleFromObjective(trimmedObjective),
      objective: trimmedObjective,
      organization_id: organizationId ?? referenceTicket?.organization_id ?? 0,
      project_id: projectId ?? referenceTicket?.project_id ?? '',
      project_name: referenceTicket?.project_name ?? null,
      project_color: referenceTicket?.project_color ?? null,
      project_everhour_project_id: referenceTicket?.project_everhour_project_id ?? null,
      everhour_task_id: null,
      agent_session_state: null,
      status,
      priority: 'medium',
      execution_target: 'agent',
      assigned_agent: null,
      board_position: positionInColumn,
      organization_name: referenceTicket?.organization_name ?? null,
      waiting_for_response_at: null,
      has_unopened_waiting_response: false,
      is_read: true
    };

    setTickets(prev => [...prev, optimisticTicket]);

    try {
      const result = await createTicketInColumnAction(
        status,
        trimmedObjective,
        clientTicketId,
        organizationId,
        projectId,
        position
      );
      router.push(
        buildTicketPath({ projectId: result.projectId, ticketId: result.id }) + '?focus=objective'
      );
    } catch {
      setTickets(prev => prev.filter(t => t.id !== clientTicketId));
    }
  }

  const uncategorizedColumn: StatusColumn = {
    id: UNCATEGORIZED_COLUMN_ID,
    title: 'Uncategorized',
    position: 999
  };

  return (
    <>
      <DndContext
        id="tickets-kanban-dnd"
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <KanbanBoardToolbar
            initialView={initialView}
            projectId={projectId}
            projectOptions={projectOptions}
            filteredProjectId={filteredProjectId}
            onFilterProject={setFilteredProjectId}
            columns={sortedColumns}
            visibleSlugs={visibleSlugs}
            showUncategorized={uncategorized.length > 0}
            onToggleColumnVisibility={toggleColumnVisibility}
            onOpenProjectSettings={projectSettings?.openProjectSettings}
          />
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="min-h-0 min-w-0 flex-1 overflow-x-scroll mt-2"
          >
            <div className="inline-flex flex-nowrap gap-3 px-4 md:px-6">
              {visibleSortedColumns.map(col => {
                const colTickets = columnTickets.get(col.id) ?? [];
                const loadMoreState = columnLoadMoreStates.get(col.id);
                const hasMore =
                  loadMoreState?.hasMore ??
                  (initialHasMoreByColumn.get(col.id) ?? 0) >= TICKETS_PAGE_SIZE;
                const isLoadingMore = loadMoreState?.isLoading ?? false;
                return (
                  <KanbanColumn
                    key={col.id}
                    column={col}
                    tickets={colTickets}
                    showOrganizationName={showOrganizationName}
                    projectId={projectId}
                    fileMentionPaths={fileMentionPaths}
                    workingDirectory={workingDirectory}
                    onCreateTicket={handleCreateTicket}
                    onCreateAndOpenTicket={handleCreateAndOpenTicket}
                    onMarkRead={handleMarkRead}
                    onMarkUnread={handleMarkUnread}
                    onMarkAllRead={() => handleMarkColumnRead(colTickets.map(t => t.id))}
                    isCompleteColumn={col.statusType === 'complete'}
                    hasMore={hasMore}
                    isLoadingMore={isLoadingMore}
                    onLoadMore={() => void handleLoadMore(col.id)}
                  />
                );
              })}
              {showUncategorized && (
                <KanbanColumn
                  column={uncategorizedColumn}
                  tickets={uncategorized}
                  showOrganizationName={showOrganizationName}
                  projectId={projectId}
                  fileMentionPaths={fileMentionPaths}
                  workingDirectory={workingDirectory}
                  onCreateTicket={handleCreateTicket}
                  onCreateAndOpenTicket={handleCreateAndOpenTicket}
                  onMarkRead={handleMarkRead}
                  onMarkUnread={handleMarkUnread}
                  onMarkAllRead={() => handleMarkColumnRead(uncategorized.map(t => t.id))}
                  isCompleteColumn={false}
                  hasMore={false}
                  isLoadingMore={false}
                />
              )}
            </div>
          </div>
        </div>

        <DragOverlay>
          {activeTicket ? (
            <KanbanCard
              ticket={activeTicket}
              isDragOverlay
              showOrganizationName={showOrganizationName}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
