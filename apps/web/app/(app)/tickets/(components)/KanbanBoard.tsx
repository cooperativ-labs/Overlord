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

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { upsertProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { loadMoreTicketsAction, markTicketsReadAction } from '@/lib/actions/tickets';
import { useTicketTagsBatch } from '@/lib/client-data/tags/hooks';
import { selectAllTickets } from '@/lib/client-data/tickets/board-selectors';
import { mergeTicketsIntoBoards, updateTicketInBoards } from '@/lib/client-data/tickets/cache';
import { useTicketBoard } from '@/lib/client-data/tickets/hooks';
import {
  useCreateTicketMutation,
  useMarkTicketReadMutation,
  useReorderTicketsMutation
} from '@/lib/client-data/tickets/mutations';
import {
  normalizeTicketListFilters,
  type TicketListFilters
} from '@/lib/helpers/ticket-list-filters';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import {
  areFilterIdsEqual,
  buildTagFilterOptions,
  readStoredListFilters,
  writeStoredListFilters
} from '@/lib/helpers/ticket-tag-filters';
import {
  getOpenedWaitingTimestamps,
  getWaitingRaisedWhileOpenMap,
  markTicketWaitingOpened,
  markTicketWaitingUnread
} from '@/lib/helpers/ticket-waiting-response';

import KanbanBoardToolbar from './KanbanBoardToolbar';
import KanbanCard, { type Ticket } from './KanbanCard';
import KanbanColumn from './KanbanColumn';
import {
  buildBoardBootstrap,
  buildBoardScope,
  buildOptimisticTicket,
  formatStatusLabel,
  getPathTicketId,
  toBoardTicket,
  toViewTicket
} from './ticket-view-helpers';
import { useTicketBoardRealtime } from './useTicketBoardRealtime';

const UNCATEGORIZED_COLUMN_ID = '__uncategorized';
const PERSONAL_PROJECT_FILTER_ID = '__personal__';
const EMPTY_FILE_MENTION_PATHS: string[] = [];
const USER_HIDDEN_COLUMNS_KEY = 'overlord:user-board:hidden-columns';
const TICKETS_PAGE_SIZE = 20;

type StatusColumn = {
  id: string;
  title: string;
  position: number;
  statusType?: string;
};

export default function KanbanBoard({
  tickets: initialTickets,
  statuses,
  showOrganizationName = false,
  organizationId,
  projectId,
  fileMentionPaths = EMPTY_FILE_MENTION_PATHS,
  workingDirectory = null,
  initialView,
  initialHiddenColumns = [],
  initialListFilters,
  scheduledVisibilityDays
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
  initialListFilters?: TicketListFilters | null;
  scheduledVisibilityDays: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();
  const projectSettings = useProjectSettings();
  const { defaultProject } = useDefaultProject();
  const boardScope = useMemo(
    () => buildBoardScope({ organizationId, projectId }),
    [organizationId, projectId]
  );
  const boardBootstrap = useMemo(
    () => buildBoardBootstrap({ scope: boardScope, tickets: initialTickets, statuses }),
    [boardScope, initialTickets, statuses]
  );
  const boardQuery = useTicketBoard(boardScope, boardBootstrap, {
    dataset: 'board'
  });
  const tickets = useMemo(
    () => (boardQuery.data ? selectAllTickets(boardQuery.data).map(toViewTicket) : initialTickets),
    [boardQuery.data, initialTickets]
  );
  const visibleTicketIds = useMemo(() => tickets.map(ticket => ticket.id), [tickets]);
  const { data: tagsByTicketId } = useTicketTagsBatch(visibleTicketIds);
  const createTicketMutation = useCreateTicketMutation();
  const reorderTicketsMutation = useReorderTicketsMutation();
  const { mutate: markTicketRead } = useMarkTicketReadMutation();
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [storedListFilters] = useState<TicketListFilters | null>(() =>
    projectId ? null : readStoredListFilters()
  );
  const [filteredProjectIds, setFilteredProjectIds] = useState<string[]>(() => {
    if (projectId) return [];
    const fromInitial = initialListFilters?.filter_project_ids;
    if (fromInitial && fromInitial.length > 0) return [...fromInitial];
    const fromStored = storedListFilters?.filter_project_ids;
    if (fromStored && fromStored.length > 0) return [...fromStored];
    return [];
  });
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(() => {
    const fromInitial = initialListFilters?.filter_tag_ids;
    if (fromInitial && fromInitial.length > 0) return [...fromInitial];
    const fromStored = storedListFilters?.filter_tag_ids;
    if (fromStored && fromStored.length > 0) return [...fromStored];
    return [];
  });
  const persistedSelectedStatuses = useMemo(
    () => initialListFilters?.selected_statuses ?? storedListFilters?.selected_statuses ?? [],
    [initialListFilters?.selected_statuses, storedListFilters?.selected_statuses]
  );

  // Tracks the column a card is being dragged into, for immediate synchronous
  // re-render of SortableContext items (shows the insertion gap in the target column).
  const [activeDragStatus, setActiveDragStatus] = useState<{
    ticketId: string;
    status: string;
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollKey = `kanban-scroll:${projectId ?? organizationId ?? 'default'}`;
  const handleTicketRemoved = useCallback((ticketId: string) => {
    setActiveTicket(prev => (prev?.id === ticketId ? null : prev));
    setActiveDragStatus(prev => (prev?.ticketId === ticketId ? null : prev));
  }, []);

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

  const {
    ticketsWithIndicators,
    openTicketIdRef,
    ticketIdsRef,
    ticketsByIdRef,
    setOpenedWaitingTimestamps,
    setWaitingRaisedWhileOpen,
    mergeWaitingFromLoadedTickets
  } = useTicketBoardRealtime({
    tickets: dragAdjustedTickets,
    organizationId,
    projectId,
    queryClient,
    onTicketRemoved: handleTicketRemoved
  });

  // Keep a mutable ref for the working ticket list during drag
  const workingTickets = useRef(dragAdjustedTickets);
  workingTickets.current = dragAdjustedTickets;

  // Derive unique projects for the project filter (only relevant on all-tasks views)
  const projectOptions = useMemo(() => {
    if (projectId) return [];
    const seen = new Map<string, { id: string; name: string; color: string | null }>();
    for (const ticket of tickets) {
      const optionId = ticket.project_id ?? PERSONAL_PROJECT_FILTER_ID;
      if (!seen.has(optionId)) {
        seen.set(optionId, {
          id: optionId,
          name: ticket.project_name ?? ticket.project_id ?? 'Inbox',
          color: ticket.project_color ?? null
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [projectId, tickets]);
  const tagOptions = useMemo(
    () => buildTagFilterOptions(tagsByTicketId as Record<string, Ticket['tags']> | undefined),
    [tagsByTicketId]
  );

  const saveListFilters = useCallback(
    (nextProjectIds: string[], nextTagIds: string[]) => {
      const nextFilters = normalizeTicketListFilters({
        selected_statuses: persistedSelectedStatuses,
        filter_project_ids: projectId ? [] : nextProjectIds,
        filter_tag_ids: nextTagIds
      });

      if (projectId) {
        startTransition(() => {
          void upsertProjectUserPreferencesAction(projectId, { list_filters: nextFilters });
        });
        return;
      }

      try {
        writeStoredListFilters(nextFilters);
      } catch {
        // ignore localStorage errors
      }
    },
    [persistedSelectedStatuses, projectId, startTransition]
  );

  const toggleFilteredProject = useCallback(
    (projectFilterId: string) => {
      setFilteredProjectIds(prev => {
        const next = prev.includes(projectFilterId)
          ? prev.filter(id => id !== projectFilterId)
          : [...prev, projectFilterId];
        queueMicrotask(() => {
          saveListFilters(next, selectedTagIds);
        });
        return next;
      });
    },
    [saveListFilters, selectedTagIds]
  );

  const clearProjectFilter = useCallback(() => {
    setFilteredProjectIds([]);
    saveListFilters([], selectedTagIds);
  }, [saveListFilters, selectedTagIds]);

  const toggleTagFilter = useCallback(
    (tagId: string) => {
      setSelectedTagIds(prev => {
        const next = prev.includes(tagId)
          ? prev.filter(currentTagId => currentTagId !== tagId)
          : [...prev, tagId];
        queueMicrotask(() => {
          saveListFilters(filteredProjectIds, next);
        });
        return next;
      });
    },
    [filteredProjectIds, saveListFilters]
  );

  const clearTagFilter = useCallback(() => {
    setSelectedTagIds([]);
    saveListFilters(filteredProjectIds, []);
  }, [filteredProjectIds, saveListFilters]);

  const displayedTickets = useMemo(
    () =>
      ticketsWithIndicators
        .filter(t => {
          const matchesProject =
            filteredProjectIds.length === 0 ||
            filteredProjectIds.includes(t.project_id ?? PERSONAL_PROJECT_FILTER_ID);
          const matchesTag =
            selectedTagIds.length === 0 ||
            (tagsByTicketId?.[t.id] ?? []).some(tag =>
              selectedTagIds.includes(tag.tagDefinitionId)
            );
          return matchesProject && matchesTag;
        })
        .map(ticket => ({
          ...ticket,
          tags: tagsByTicketId?.[ticket.id] ?? []
        })),
    [filteredProjectIds, selectedTagIds, tagsByTicketId, ticketsWithIndicators]
  );

  useEffect(() => {
    if (projectId) return;
    if (filteredProjectIds.length === 0) return;
    const validIds = new Set(projectOptions.map(project => project.id));
    const next = filteredProjectIds.filter(id => validIds.has(id));
    if (areFilterIdsEqual(next, filteredProjectIds)) return;
    saveListFilters(next, selectedTagIds);
    setFilteredProjectIds(next);
  }, [filteredProjectIds, projectId, projectOptions, saveListFilters, selectedTagIds]);

  useEffect(() => {
    if (selectedTagIds.length === 0) return;
    const validIds = new Set(tagOptions.map(tag => tag.id));
    const next = selectedTagIds.filter(id => validIds.has(id));
    if (areFilterIdsEqual(next, selectedTagIds)) return;
    saveListFilters(filteredProjectIds, next);
    setSelectedTagIds(next);
  }, [filteredProjectIds, saveListFilters, selectedTagIds, tagOptions]);

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
      if (ticket.waiting_for_response_at) {
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
      mergeWaitingFromLoadedTickets(loaded as Ticket[]);
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
  }, [
    markTicketRead,
    openTicketIdRef,
    pathname,
    setOpenedWaitingTimestamps,
    setWaitingRaisedWhileOpen,
    ticketIdsRef,
    ticketsByIdRef
  ]);

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
    const optimisticTicket = buildOptimisticTicket({
      id: clientTicketId,
      objective: trimmedObjective,
      status,
      position,
      tickets: workingTickets.current,
      organizationId,
      projectId,
      defaultProject
    });

    try {
      await createTicketMutation.mutateAsync({
        optimisticTicket: toBoardTicket(optimisticTicket),
        status,
        objective: trimmedObjective,
        organizationId,
        projectId: optimisticTicket.project_id ?? undefined,
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
    const optimisticTicket = buildOptimisticTicket({
      id: clientTicketId,
      objective: trimmedObjective,
      status,
      position,
      tickets: workingTickets.current,
      organizationId,
      projectId,
      defaultProject
    });

    try {
      const result = await createTicketMutation.mutateAsync({
        optimisticTicket: toBoardTicket(optimisticTicket),
        status,
        objective: trimmedObjective,
        organizationId,
        projectId: optimisticTicket.project_id ?? undefined,
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
            filteredProjectIds={filteredProjectIds}
            tagOptions={tagOptions}
            selectedTagIds={selectedTagIds}
            onToggleFilterProject={toggleFilteredProject}
            onClearProjectFilter={clearProjectFilter}
            onToggleTag={toggleTagFilter}
            onClearTagFilter={clearTagFilter}
            columns={sortedColumns}
            visibleSlugs={visibleSlugs}
            showUncategorized={uncategorized.length > 0}
            scheduledVisibilityDays={scheduledVisibilityDays}
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
