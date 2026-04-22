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
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { upsertProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { loadMoreTicketsAction, markTicketsReadAction } from '@/lib/actions/tickets';
import { selectAllTickets } from '@/lib/client-data/tickets/board-selectors';
import {
  mergeObjectiveMetaIntoBoards,
  mergeSessionMetaIntoBoards,
  mergeTicketsIntoBoards,
  mergeWaitingQuestionIntoBoards,
  reconcileRealtimeTicketRow,
  removeTicketFromBoards,
  updateTicketInBoards
} from '@/lib/client-data/tickets/cache';
import { useTicketBoard } from '@/lib/client-data/tickets/hooks';
import {
  useCreateTicketMutation,
  useMarkTicketReadMutation,
  useReorderTicketsMutation
} from '@/lib/client-data/tickets/mutations';
import { parseTicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import {
  TICKET_DELETED_EVENT,
  type TicketDeletedEventDetail
} from '@/lib/helpers/ticket-board-events';
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
const PERSONAL_PROJECT_FILTER_ID = '__personal__';
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
type Objective = Database['public']['Tables']['objectives']['Row'];
type RealtimeBoardTicketRow = {
  id: string;
  title: string | null;
  due_datetime: string | null;
  execution_target: Database['public']['Enums']['ticket_execution_target'];
  status: string;
  priority: string;
  assigned_agent: Database['public']['Tables']['tickets']['Row']['assigned_agent'];
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

import {
  buildBoardBootstrap,
  buildBoardScope,
  formatStatusLabel,
  getPathTicketId,
  toBoardTicket,
  toViewTicket
} from './ticket-view-helpers';

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
    assigned_agent: parseTicketAssignedAgent(row.assigned_agent),
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
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();
  const projectSettings = useProjectSettings();
  const boardScope = useMemo(
    () => buildBoardScope({ organizationId, projectId }),
    [organizationId, projectId]
  );
  const boardBootstrap = useMemo(
    () => buildBoardBootstrap({ scope: boardScope, tickets: initialTickets, statuses }),
    [boardScope, initialTickets, statuses]
  );
  const boardQuery = useTicketBoard(boardScope, boardBootstrap, {
    dataset: 'board',
    refetchInterval: 20_000
  });
  const tickets = useMemo(
    () => (boardQuery.data ? selectAllTickets(boardQuery.data).map(toViewTicket) : initialTickets),
    [boardQuery.data, initialTickets]
  );
  const createTicketMutation = useCreateTicketMutation();
  const reorderTicketsMutation = useReorderTicketsMutation();
  const { mutate: markTicketRead } = useMarkTicketReadMutation();
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
      setActiveTicket(prev => (prev?.id === ticketId ? null : prev));
      setActiveDragStatus(prev => (prev?.ticketId === ticketId ? null : prev));
    },
    [queryClient]
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
      const optionId = ticket.project_id ?? PERSONAL_PROJECT_FILTER_ID;
      if (!seen.has(optionId)) {
        seen.set(optionId, {
          id: optionId,
          name: ticket.project_name ?? ticket.project_id ?? 'Personal',
          color: ticket.project_color ?? null
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [projectId, tickets]);

  const displayedTickets = useMemo(
    () =>
      filteredProjectId
        ? ticketsWithIndicators.filter(t =>
            filteredProjectId === PERSONAL_PROJECT_FILTER_ID
              ? t.project_id === null
              : t.project_id === filteredProjectId
          )
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
      for (const id of unreadSet) {
        updateTicketInBoards(queryClient, id, { is_read: true });
      }
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

    markTicketRead({ ticketId, isRead: false });
  }

  function handleMarkRead(ticketId: string) {
    const ticket = ticketsByIdRef.current.get(ticketId);
    if (!ticket) return;

    markTicketRead({ ticketId, isRead: true });
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

      mergeTicketsIntoBoards(queryClient, (loaded as Ticket[]).map(toBoardTicket), 'server-poll');
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
      markTicketRead({ ticketId: pathTicketId, isRead: true });
    }
  }, [markTicketRead, pathname]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const fetchRealtimeBoardTicket = async (ticketId: string): Promise<Ticket | null> => {
      let query = supabase
        .from('tickets')
        .select(
          'id,title,due_datetime,execution_target,status,priority,assigned_agent,delegate,is_read,updated_at,board_position,organization_id,project_id,everhour_task_id,schedule_id,organization:organizations(name),project:projects(name,color,everhour_project_id)'
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
          .select('state,agent_identifier')
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
      let executingObjectiveAgent: string | null = null;
      let executedObjectivesCount = 0;

      for (const objective of (objectives ?? []) as Array<{
        state: string | null;
        agent_identifier: string | null;
      }>) {
        if (latestObjectiveAgent === null) {
          latestObjectiveAgent = objective.agent_identifier ?? null;
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
          .select('id,status,title,assigned_agent,delegate,is_read,board_position,updated_at')
          .in('id', ticketIds),
        supabase
          .from('objectives')
          .select('ticket_id,state,agent_identifier')
          .in('ticket_id', ticketIds)
          .order('created_at', { ascending: false })
      ]);

      if (cancelled) return;

      const latestObjectiveAgentByTicket = new Map<string, string | null>();
      const executingObjectiveAgentByTicket = new Map<string, string>();
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
            assigned_agent: Database['public']['Tables']['tickets']['Row']['assigned_agent'];
            delegate: string | null;
            is_read: boolean;
            board_position: number;
            updated_at: string;
          }>
        ).map(t => [t.id, t])
      );

      for (const objective of (objectives ?? []) as Array<{
        ticket_id: string;
        state: string | null;
        agent_identifier: string | null;
      }>) {
        if (!latestObjectiveAgentByTicket.has(objective.ticket_id)) {
          latestObjectiveAgentByTicket.set(objective.ticket_id, objective.agent_identifier ?? null);
        }
        if (
          objective.state === 'executing' &&
          objective.agent_identifier &&
          !executingObjectiveAgentByTicket.has(objective.ticket_id)
        ) {
          executingObjectiveAgentByTicket.set(objective.ticket_id, objective.agent_identifier);
        }
      }

      for (const t of ticketsByIdRef.current.values()) {
        const update = ticketUpdateMap.get(t.id);
        if (!update) continue;
        const session = sessionByTicket.get(t.id);
        const isAttached = session?.session_state === 'attached';
        const runningAgent =
          executingObjectiveAgentByTicket.get(t.id) ??
          (isAttached ? session.agent_identifier : null);
        updateTicketInBoards(queryClient, t.id, {
          status: update.status ?? t.status,
          title: update.title ?? t.title,
          is_read: update.is_read ?? t.is_read,
          board_position: update.board_position ?? t.board_position,
          updated_at: update.updated_at ?? t.updated_at,
          latest_objective_agent:
            latestObjectiveAgentByTicket.get(t.id) ?? t.latest_objective_agent,
          assigned_agent: parseTicketAssignedAgent(update.assigned_agent) ?? t.assigned_agent,
          delegate: update.delegate,
          agent_session_state: session?.session_state ?? t.agent_session_state ?? null,
          running_agent: runningAgent,
          has_executing_objective: executingObjectiveAgentByTicket.has(t.id)
        });
        mergeObjectiveMetaIntoBoards(queryClient, t.id, {
          latest_agent: latestObjectiveAgentByTicket.get(t.id) ?? t.latest_objective_agent ?? null,
          executing_agent: executingObjectiveAgentByTicket.get(t.id) ?? null
        });
      }

      const nextWaitingByTicket = { ...waitingByTicketRef.current };
      const raisedWaitingTicketIds: string[] = [];
      let waitingChanged = false;
      for (const q of (waitingQuestions ?? []) as { ticket_id: string; created_at: string }[]) {
        if (
          !nextWaitingByTicket[q.ticket_id] ||
          Date.parse(q.created_at) > Date.parse(nextWaitingByTicket[q.ticket_id])
        ) {
          nextWaitingByTicket[q.ticket_id] = q.created_at;
          mergeWaitingQuestionIntoBoards(queryClient, q);
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
          const ticketId =
            getObjectivePayloadTicketId(payload.new) ?? getObjectivePayloadTicketId(payload.old);
          if (!ticketId || !ticketIdsRef.current.has(ticketId)) return;
          void syncObjectiveStateForTicket(ticketId);
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
  }, [organizationId, projectId, queryClient, removeTicketFromBoard]);

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

    reorderTicketsMutation.mutate({
      status: columnSlug,
      orderedIds,
      statusChange: statusChanged && col ? { ticketId: activeId, newStatus: col.id } : undefined
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
      project_id: projectId ?? referenceTicket?.project_id ?? null,
      project_name: referenceTicket?.project_name ?? (projectId ? null : 'Personal'),
      project_color: referenceTicket?.project_color ?? null,
      project_everhour_project_id:
        (projectId ?? referenceTicket?.project_id)
          ? (referenceTicket?.project_everhour_project_id ?? null)
          : null,
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

    try {
      await createTicketMutation.mutateAsync({
        optimisticTicket: toBoardTicket(optimisticTicket),
        status,
        objective: trimmedObjective,
        organizationId,
        projectId,
        placement: position
      });
    } catch {
      // useCreateTicketMutation restores the previous cache snapshot.
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
      project_id: projectId ?? referenceTicket?.project_id ?? null,
      project_name: referenceTicket?.project_name ?? (projectId ? null : 'Personal'),
      project_color: referenceTicket?.project_color ?? null,
      project_everhour_project_id:
        (projectId ?? referenceTicket?.project_id)
          ? (referenceTicket?.project_everhour_project_id ?? null)
          : null,
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

    try {
      const result = await createTicketMutation.mutateAsync({
        optimisticTicket: toBoardTicket(optimisticTicket),
        status,
        objective: trimmedObjective,
        organizationId,
        projectId,
        placement: position
      });
      router.push(
        buildTicketPath({ projectId: result.projectId, ticketId: result.id }) + '?focus=objective'
      );
    } catch {
      // useCreateTicketMutation restores the previous cache snapshot.
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
                    statusType={col.statusType}
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
