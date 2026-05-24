'use client';

import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Circle, Eye, NotebookPen, Play } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { Card, CardContent } from '@/components/ui/card';
import { upsertGlobalListViewPreferencesAction } from '@/lib/actions/global-list-view-preferences';
import { upsertProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { loadMoreTicketsAction } from '@/lib/actions/tickets';
import { useTicketTagsBatch } from '@/lib/client-data/tags/hooks';
import { selectAllTickets } from '@/lib/client-data/tickets/board-selectors';
import { mergeTicketsIntoBoards } from '@/lib/client-data/tickets/cache';
import { useTicketBoard } from '@/lib/client-data/tickets/hooks';
import {
  useCreateTicketMutation,
  useMarkTicketReadMutation,
  useReorderTicketsMutation,
  useUpdateTicketStatusMutation
} from '@/lib/client-data/tickets/mutations';
import {
  normalizeStringList,
  normalizeTicketListFilters,
  type TicketListFilters
} from '@/lib/helpers/ticket-list-filters';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import {
  buildTagFilterOptions,
  readStoredListFilters,
  writeStoredListFilters
} from '@/lib/helpers/ticket-tag-filters';
import {
  getWaitingRaisedWhileOpenMap,
  markTicketWaitingOpened
} from '@/lib/helpers/ticket-waiting-response';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

import type { Ticket } from './KanbanCard';
import {
  buildBoardBootstrap,
  buildBoardScope,
  buildOptimisticTicket,
  formatStatusLabel,
  getPathTicketId,
  toBoardTicket,
  toViewTicket
} from './ticket-view-helpers';
import { TicketListStatusGroup } from './TicketListStatusGroup';
import { TicketListToolbar } from './TicketListToolbar';
import type {
  SortKey,
  TicketListProjectOption,
  TicketListStatusStyle,
  TicketTagFilterOption
} from './TicketListView.types';
import { useTicketBoardRealtime } from './useTicketBoardRealtime';

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];
const DEFAULT_SELECTED_STATUSES = ['draft', 'execute', 'review'] as const;
const PERSONAL_PROJECT_FILTER_ID = '__personal__';
const TICKETS_PAGE_SIZE = 20;
/** Sentinel for "drop after last status" - not a real status name. */
const STATUS_REORDER_DROP_END = '__overlord_status_reorder_end__';

function areStringListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areProjectFilterIdsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function buildStatusFilterOptions(availableStatuses: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const status of DEFAULT_SELECTED_STATUSES) {
    if (seen.has(status)) continue;
    seen.add(status);
    next.push(status);
  }

  for (const status of availableStatuses) {
    if (seen.has(status)) continue;
    seen.add(status);
    next.push(status);
  }

  return next;
}

function sanitizeSelectedStatuses(current: string[], availableStatuses: string[]): string[] {
  if (availableStatuses.length === 0) {
    return current;
  }
  if (current.length === 0) {
    return current;
  }

  const availableSet = new Set(availableStatuses);
  const next = current.filter(status => availableSet.has(status));
  return next.length > 0 ? next : availableStatuses;
}

function getStatusStyle(statusType: string | undefined, statusName: string): TicketListStatusStyle {
  if (statusType === 'execute')
    return {
      text: 'text-blue-500',
      bg: 'bg-blue-500/15',
      rule: 'bg-blue-500/30',
      rail: 'border-blue-500/30',
      icon: Play
    };
  if (statusType === 'complete')
    return {
      text: 'text-emerald-500',
      bg: 'bg-emerald-500/15',
      rule: 'bg-emerald-500/30',
      rail: 'border-emerald-500/30',
      icon: CheckCheck
    };
  if (statusType === 'review')
    return {
      text: 'text-cyan-500',
      bg: 'bg-cyan-500/15',
      rule: 'bg-cyan-500/30',
      rail: 'border-cyan-500/30',
      icon: Eye
    };
  if (statusName === 'draft')
    return {
      text: 'text-muted-foreground',
      bg: 'bg-muted',
      rule: 'bg-border',
      rail: 'border-border',
      icon: NotebookPen
    };
  // next-up / other
  return {
    text: 'text-sky-600 dark:text-sky-400',
    bg: 'bg-sky-500/15',
    rule: 'bg-sky-500/30',
    rail: 'border-sky-500/30',
    icon: Circle
  };
}

export default function TicketListView({
  tickets: initialTickets,
  statuses,
  showOrganizationName = false,
  ticketUrlBase,
  initialView,
  showViewToggle = true,
  organizationId,
  projectId,
  initialListFilters,
  initialCollapsedStatuses,
  initialStatusOrder,
  scheduledVisibilityDays
}: {
  tickets: Ticket[];
  statuses: Array<{ name: string; position: number; status_type?: string }>;
  showOrganizationName?: boolean;
  ticketUrlBase?: string;
  initialView: string;
  showViewToggle?: boolean;
  organizationId?: number;
  projectId?: string;
  initialListFilters?: TicketListFilters | null;
  initialCollapsedStatuses?: string[];
  initialStatusOrder?: string[];
  scheduledVisibilityDays: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();
  const boardScope = useMemo(
    () => buildBoardScope({ organizationId, projectId }),
    [organizationId, projectId]
  );
  const boardBootstrap = useMemo(
    () => buildBoardBootstrap({ scope: boardScope, tickets: initialTickets, statuses }),
    [boardScope, initialTickets, statuses]
  );
  const boardQuery = useTicketBoard(boardScope, boardBootstrap, { dataset: 'list' });
  const tickets = useMemo(
    () => (boardQuery.data ? selectAllTickets(boardQuery.data).map(toViewTicket) : initialTickets),
    [boardQuery.data, initialTickets]
  );

  const updateStatusMutation = useUpdateTicketStatusMutation();
  const createTicketMutation = useCreateTicketMutation();
  const reorderMutation = useReorderTicketsMutation();
  const { mutate: markTicketRead } = useMarkTicketReadMutation();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { defaultProject } = useDefaultProject();

  const visibleTicketIds = useMemo(() => tickets.map(t => t.id), [tickets]);
  const { data: tagsByTicketId } = useTicketTagsBatch(visibleTicketIds);

  const [storedListFilters] = useState<TicketListFilters | null>(() =>
    projectId ? null : readStoredListFilters()
  );
  const [sortKey, setSortKey] = useState<SortKey>('updated_at');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(() =>
    normalizeStringList(
      initialListFilters?.selected_statuses ??
        storedListFilters?.selected_statuses ?? [...DEFAULT_SELECTED_STATUSES]
    )
  );
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>(() => {
    if (projectId) return [];
    const fromInitial = initialListFilters?.filter_project_ids;
    if (fromInitial && fromInitial.length > 0) return [...fromInitial];
    const fromStored = storedListFilters?.filter_project_ids;
    if (fromStored && fromStored.length > 0) return [...fromStored];
    return [];
  });
  const [filterTagIds, setFilterTagIds] = useState<string[]>(() => {
    const fromInitial = initialListFilters?.filter_tag_ids;
    if (fromInitial && fromInitial.length > 0) return [...fromInitial];
    const fromStored = storedListFilters?.filter_tag_ids;
    if (fromStored && fromStored.length > 0) return [...fromStored];
    return [];
  });

  const [expandedStatuses, setExpandedStatuses] = useState<Record<string, boolean>>({});
  const [collapsedStatuses, setCollapsedStatuses] = useState<Set<string>>(
    () => new Set(initialCollapsedStatuses ?? [])
  );
  const [customStatusOrder, setCustomStatusOrder] = useState<string[] | null>(() =>
    initialStatusOrder && initialStatusOrder.length > 0 ? [...initialStatusOrder] : null
  );
  type StatusLoadMoreState = { cutoff: string; hasMore: boolean; isLoading: boolean };
  const [statusLoadMoreStates, setStatusLoadMoreStates] = useState<
    Map<string, StatusLoadMoreState>
  >(() => new Map());

  const [draggedTicketId, setDraggedTicketId] = useState<string | null>(null);
  const [dropTargetStatus, setDropTargetStatus] = useState<string | null>(null);
  const [draggedStatusName, setDraggedStatusName] = useState<string | null>(null);
  const [dropTargetStatusForReorder, setDropTargetStatusForReorder] = useState<string | null>(null);
  const [activeBlankStatus, setActiveBlankStatus] = useState<string | null>(null);

  const {
    ticketsWithIndicators,
    openTicketIdRef,
    ticketIdsRef,
    ticketsByIdRef,
    setOpenedWaitingTimestamps,
    setWaitingRaisedWhileOpen,
    mergeWaitingFromLoadedTickets
  } = useTicketBoardRealtime({
    tickets,
    organizationId,
    projectId,
    queryClient
  });

  function handleMarkUnread(ticketId: string) {
    markTicketRead({ ticketId, isRead: false });
  }

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

  const uniqueStatuses = useMemo(() => {
    const seen = new Set<string>();
    for (const t of tickets) seen.add(t.status);
    return [...seen].sort();
  }, [tickets]);
  const statusFilterOptions = useMemo(
    () => buildStatusFilterOptions(uniqueStatuses),
    [uniqueStatuses]
  );

  const projectOptions = useMemo(() => {
    const seen = new Map<string, TicketListProjectOption>();
    for (const t of tickets) {
      const optionId = t.project_id ?? PERSONAL_PROJECT_FILTER_ID;
      if (!seen.has(optionId)) {
        seen.set(optionId, {
          id: optionId,
          name: t.project_name ?? t.project_id ?? 'Inbox',
          color: t.project_color ?? null
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tickets]);
  const tagOptions = useMemo(
    () => buildTagFilterOptions(tagsByTicketId as Record<string, Ticket['tags']> | undefined),
    [tagsByTicketId]
  );

  const saveListFilters = useCallback(
    (
      nextSelectedStatuses: string[],
      nextFilterProjectIds: string[],
      nextFilterTagIds: string[]
    ) => {
      const nextFilters = normalizeTicketListFilters({
        selected_statuses: nextSelectedStatuses,
        filter_project_ids: projectId ? [] : nextFilterProjectIds,
        filter_tag_ids: nextFilterTagIds
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
        // ignore localStorage errors (quota, private browsing)
      }
    },
    [projectId, startTransition]
  );

  const saveStatusViewPreferences = useCallback(
    (nextCollapsed: string[], nextOrder: string[]) => {
      if (projectId) {
        startTransition(() => {
          void upsertProjectUserPreferencesAction(projectId, {
            list_collapsed_statuses: nextCollapsed,
            list_status_order: nextOrder
          });
        });
      } else {
        startTransition(() => {
          void upsertGlobalListViewPreferencesAction({
            list_collapsed_statuses: nextCollapsed,
            list_status_order: nextOrder
          });
        });
      }
    },
    [projectId, startTransition]
  );

  const selectedStatusesSet = useMemo(() => new Set(selectedStatuses), [selectedStatuses]);
  const areAllStatusesSelected = statusFilterOptions.every(status =>
    selectedStatusesSet.has(status)
  );
  const statusFilterLabel = useMemo(() => {
    if (selectedStatuses.length === 0) return 'All';
    if (areAllStatusesSelected || statusFilterOptions.length === 0) return 'All';
    if (selectedStatuses.length === 1) return formatStatusLabel(selectedStatuses[0] ?? '');
    if (selectedStatuses.length <= 2) return selectedStatuses.map(formatStatusLabel).join(', ');
    return `${selectedStatuses.length}`;
  }, [areAllStatusesSelected, selectedStatuses, statusFilterOptions.length]);

  function toggleStatus(status: string) {
    let next: string[] = [];
    setSelectedStatuses(current => {
      next = current.includes(status)
        ? current.filter(currentStatus => currentStatus !== status)
        : [...current, status];
      return next;
    });
    queueMicrotask(() => {
      saveListFilters(next, filterProjectIds, filterTagIds);
    });
  }

  function toggleTag(tagId: string) {
    let next: string[] = [];
    setFilterTagIds(current => {
      next = current.includes(tagId)
        ? current.filter(currentTagId => currentTagId !== tagId)
        : [...current, tagId];
      return next;
    });
    queueMicrotask(() => {
      saveListFilters(selectedStatuses, filterProjectIds, next);
    });
  }

  // Filter then sort flat — grouping happens at render time.
  const filteredSortedTickets = useMemo(() => {
    let filtered = ticketsWithIndicators;
    if (!areAllStatusesSelected && selectedStatuses.length > 0) {
      filtered = filtered.filter(t => selectedStatusesSet.has(t.status));
    }
    if (filterProjectIds.length > 0) {
      filtered = filtered.filter(t => {
        const optionId = t.project_id ?? PERSONAL_PROJECT_FILTER_ID;
        return filterProjectIds.includes(optionId);
      });
    }
    if (filterTagIds.length > 0) {
      filtered = filtered.filter(ticket =>
        (tagsByTicketId?.[ticket.id] ?? []).some(tag => filterTagIds.includes(tag.tagDefinitionId))
      );
    }

    return [...filtered].sort((a, b) => {
      if (sortKey === 'updated_at')
        return Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? '');
      if (sortKey === 'status') return a.status.localeCompare(b.status);
      if (sortKey === 'priority') {
        const ai = PRIORITY_ORDER.indexOf(a.priority);
        const bi = PRIORITY_ORDER.indexOf(b.priority);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      }
      return 0;
    });
  }, [
    ticketsWithIndicators,
    sortKey,
    selectedStatusesSet,
    selectedStatuses.length,
    areAllStatusesSelected,
    filterProjectIds,
    filterTagIds,
    tagsByTicketId
  ]);

  // Group tickets by status, in the configured status order (with custom order applied).
  const orderedStatuses = useMemo(() => {
    const sortedDef = [...statuses].sort((a, b) => a.position - b.position);
    const present = new Set(filteredSortedTickets.map(t => t.status));
    const visible = sortedDef.filter(s => present.has(s.name) || selectedStatusesSet.has(s.name));
    // Append any present statuses missing from the definition.
    const seen = new Set(visible.map(s => s.name));
    for (const t of filteredSortedTickets) {
      if (!seen.has(t.status)) {
        visible.push({ name: t.status, position: 999, status_type: undefined });
        seen.add(t.status);
      }
    }
    // Apply custom order if set.
    if (customStatusOrder && customStatusOrder.length > 0) {
      const orderMap = new Map(customStatusOrder.map((name, i) => [name, i]));
      visible.sort((a, b) => {
        const ai = orderMap.get(a.name) ?? 9999;
        const bi = orderMap.get(b.name) ?? 9999;
        return ai - bi;
      });
    }
    return visible;
  }, [statuses, filteredSortedTickets, selectedStatusesSet, customStatusOrder]);

  const groupedTickets = useMemo(() => {
    const groups = new Map<string, typeof filteredSortedTickets>();
    for (const status of orderedStatuses) groups.set(status.name, []);
    for (const ticket of filteredSortedTickets) {
      const list = groups.get(ticket.status);
      if (list) list.push(ticket);
      else groups.set(ticket.status, [ticket]);
    }
    // Sort within each group by board_position, matching KanbanBoard logic.
    for (const [, group] of groups) {
      group.sort((a, b) => a.board_position - b.board_position);
    }
    return groups;
  }, [orderedStatuses, filteredSortedTickets]);

  const initialHasMoreByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ticket of initialTickets) {
      counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1);
    }
    return counts;
  }, [initialTickets]);

  async function handleLoadMore(statusName: string) {
    const state = statusLoadMoreStates.get(statusName);
    if (state?.isLoading || state?.hasMore === false) return;

    const statusTickets = groupedTickets.get(statusName) ?? [];
    const oldestUpdatedAt =
      statusTickets
        .map(ticket => ticket.updated_at)
        .filter(Boolean)
        .sort()[0] ?? new Date().toISOString();
    const cutoff = state?.cutoff ?? oldestUpdatedAt;

    setStatusLoadMoreStates(prev => {
      const next = new Map(prev);
      next.set(statusName, { cutoff, hasMore: true, isLoading: true });
      return next;
    });

    try {
      const { tickets: loaded } = await loadMoreTicketsAction({
        status: statusName,
        organizationId,
        projectId,
        beforeDate: cutoff
      });
      const newCutoff =
        loaded.length > 0 ? (loaded[loaded.length - 1].updated_at ?? cutoff) : cutoff;

      mergeTicketsIntoBoards(queryClient, (loaded as Ticket[]).map(toBoardTicket), 'server-poll');
      mergeWaitingFromLoadedTickets(loaded as Ticket[]);
      setStatusLoadMoreStates(prev => {
        const next = new Map(prev);
        next.set(statusName, {
          cutoff: newCutoff,
          hasMore: loaded.length === TICKETS_PAGE_SIZE,
          isLoading: false
        });
        return next;
      });
    } catch {
      setStatusLoadMoreStates(prev => {
        const next = new Map(prev);
        next.set(statusName, { cutoff, hasMore: true, isLoading: false });
        return next;
      });
    }
  }

  const completeStatusName = useMemo(
    () =>
      statuses.find(
        status =>
          status.status_type === 'complete' && status.name.trim().toLowerCase() !== 'cancelled'
      )?.name ?? statuses.find(status => status.status_type === 'complete')?.name,
    [statuses]
  );

  const hasTickets = tickets.length > 0;

  useEffect(() => {
    let next: string[] | undefined;
    setSelectedStatuses(current => {
      const sanitized = sanitizeSelectedStatuses(current, statusFilterOptions);
      if (areStringListsEqual(current, sanitized)) return current;
      next = sanitized;
      return sanitized;
    });
    if (next) {
      const toSave = next;
      queueMicrotask(() => {
        saveListFilters(toSave, filterProjectIds, filterTagIds);
      });
    }
  }, [filterProjectIds, filterTagIds, saveListFilters, statusFilterOptions]);

  useEffect(() => {
    if (projectId) return;
    if (filterProjectIds.length === 0) return;
    const validIds = new Set(projectOptions.map(project => project.id));
    const next = filterProjectIds.filter(id => validIds.has(id));
    if (areProjectFilterIdsEqual(next, filterProjectIds)) return;
    saveListFilters(selectedStatuses, next, filterTagIds);
    setFilterProjectIds(next);
  }, [
    filterProjectIds,
    filterTagIds,
    projectId,
    projectOptions,
    saveListFilters,
    selectedStatuses
  ]);

  useEffect(() => {
    if (filterTagIds.length === 0) return;
    const validIds = new Set(tagOptions.map(tag => tag.id));
    const next = filterTagIds.filter(id => validIds.has(id));
    if (areProjectFilterIdsEqual(next, filterTagIds)) return;
    saveListFilters(selectedStatuses, filterProjectIds, next);
    setFilterTagIds(next);
  }, [filterProjectIds, filterTagIds, saveListFilters, selectedStatuses, tagOptions]);

  function toggleExpand(statusName: string) {
    setExpandedStatuses(prev => ({ ...prev, [statusName]: !prev[statusName] }));
  }

  function toggleCollapse(statusName: string) {
    let nextCollapsed: string[] = [];
    setCollapsedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(statusName)) {
        next.delete(statusName);
      } else {
        next.add(statusName);
      }
      nextCollapsed = [...next];
      return next;
    });
    queueMicrotask(() => {
      saveStatusViewPreferences(
        nextCollapsed,
        customStatusOrder ?? orderedStatuses.map(s => s.name)
      );
    });
  }

  function clearTicketDragState() {
    setDraggedTicketId(null);
    setDropTargetStatus(null);
  }

  function moveDraggedTicketToStatus(statusName: string) {
    if (!draggedTicketId) {
      clearTicketDragState();
      return;
    }

    const draggedTicket = tickets.find(ticket => ticket.id === draggedTicketId);
    if (!draggedTicket || draggedTicket.status === statusName) {
      clearTicketDragState();
      return;
    }

    updateStatusMutation.mutate({
      ticketId: draggedTicketId,
      status: statusName,
      placement: 'bottom'
    });
    clearTicketDragState();
  }

  function handleCompleteTicket(ticketId: string) {
    if (!completeStatusName) return;
    const ticket = tickets.find(currentTicket => currentTicket.id === ticketId);
    if (!ticket || ticket.status === completeStatusName) return;

    const previousStatus = ticket.status;
    updateStatusMutation.mutate({
      ticketId,
      status: completeStatusName,
      placement: 'bottom'
    });

    toast.success(`Completed: ${getDisplayTitle(ticket)}`, {
      position: 'bottom-center',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          updateStatusMutation.mutate({
            ticketId,
            status: previousStatus,
            placement: 'top'
          });
        }
      }
    });
  }

  function handleTicketDragStart(ticketId: string, event: React.DragEvent<HTMLDivElement>) {
    setDraggedTicketId(ticketId);
    setDropTargetStatus(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', ticketId);
  }

  function handleTicketDragEnd() {
    clearTicketDragState();
  }

  // Ticket drag handlers.
  function handleTicketDragOverStatus(e: React.DragEvent, statusName: string) {
    if (draggedStatusName) return; // status reorder takes priority
    if (!draggedTicketId) return;
    const draggedTicket = tickets.find(t => t.id === draggedTicketId);
    if (!draggedTicket || draggedTicket.status === statusName) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetStatus(statusName);
  }

  function handleTicketDropOnStatus(e: React.DragEvent, statusName: string) {
    if (draggedStatusName) return;
    e.preventDefault();
    moveDraggedTicketToStatus(statusName);
  }

  function handleTicketDragLeaveStatus(e: React.DragEvent<HTMLDivElement>, statusName: string) {
    if (draggedStatusName || dropTargetStatus !== statusName) return;
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropTargetStatus(null);
    }
  }

  // Status reorder drag handlers.
  function handleStatusDragStart(e: React.DragEvent, statusName: string) {
    setDraggedStatusName(statusName);
    e.dataTransfer.effectAllowed = 'move';
    // Prevent the drag from triggering ticket-level drag logic.
    e.stopPropagation();
  }

  function handleStatusDragOver(e: React.DragEvent, statusName: string) {
    if (!draggedStatusName || draggedStatusName === statusName) return;
    const currentOrder = orderedStatuses.map(s => s.name);
    const fromIndex = currentOrder.indexOf(draggedStatusName);
    const toIndex = currentOrder.indexOf(statusName);
    if (fromIndex === -1 || toIndex === -1) return;
    // Dropping onto the status directly below is a no-op (insert-before matches current order).
    if (fromIndex < toIndex && toIndex === fromIndex + 1) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
      setDropTargetStatusForReorder(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetStatusForReorder(statusName);
  }

  function handleStatusDragOverEnd(e: React.DragEvent) {
    if (!draggedStatusName) return;
    const currentOrder = orderedStatuses.map(s => s.name);
    const fromIndex = currentOrder.indexOf(draggedStatusName);
    if (fromIndex === -1 || fromIndex === currentOrder.length - 1) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
      setDropTargetStatusForReorder(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetStatusForReorder(STATUS_REORDER_DROP_END);
  }

  function handleStatusDragLeaveEnd(e: React.DragEvent<HTMLDivElement>) {
    if (dropTargetStatusForReorder !== STATUS_REORDER_DROP_END) return;
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropTargetStatusForReorder(null);
    }
  }

  function handleStatusDrop(e: React.DragEvent, targetStatusName: string) {
    e.preventDefault();
    if (!draggedStatusName || draggedStatusName === targetStatusName) {
      setDraggedStatusName(null);
      setDropTargetStatusForReorder(null);
      return;
    }

    const currentOrder = orderedStatuses.map(s => s.name);
    const fromIndex = currentOrder.indexOf(draggedStatusName);
    const toIndex = currentOrder.indexOf(targetStatusName);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggedStatusName(null);
      setDropTargetStatusForReorder(null);
      return;
    }
    if (fromIndex < toIndex && toIndex === fromIndex + 1) {
      setDraggedStatusName(null);
      setDropTargetStatusForReorder(null);
      return;
    }

    const newOrder = [...currentOrder];
    newOrder.splice(fromIndex, 1);
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    newOrder.splice(insertAt, 0, draggedStatusName);
    setCustomStatusOrder(newOrder);
    saveStatusViewPreferences([...collapsedStatuses], newOrder);

    setDraggedStatusName(null);
    setDropTargetStatusForReorder(null);
  }

  function handleStatusDropEnd(e: React.DragEvent) {
    e.preventDefault();
    if (!draggedStatusName) {
      setDropTargetStatusForReorder(null);
      return;
    }
    const currentOrder = orderedStatuses.map(s => s.name);
    const fromIndex = currentOrder.indexOf(draggedStatusName);
    if (fromIndex === -1 || fromIndex === currentOrder.length - 1) {
      setDraggedStatusName(null);
      setDropTargetStatusForReorder(null);
      return;
    }
    const newOrder = [...currentOrder];
    newOrder.splice(fromIndex, 1);
    newOrder.push(draggedStatusName);
    setCustomStatusOrder(newOrder);
    saveStatusViewPreferences([...collapsedStatuses], newOrder);
    setDraggedStatusName(null);
    setDropTargetStatusForReorder(null);
  }

  function handleStatusDragEnd() {
    setDraggedStatusName(null);
    setDropTargetStatusForReorder(null);
  }

  function handleDndDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTicket = tickets.find(t => t.id === activeId);
    const overTicket = tickets.find(t => t.id === overId);
    if (!activeTicket || !overTicket) return;

    const sourceStatus = activeTicket.status;
    const targetStatus = overTicket.status;
    const fullSource = groupedTickets.get(sourceStatus) ?? [];

    if (sourceStatus === targetStatus) {
      const oldIndex = fullSource.findIndex(t => t.id === activeId);
      const newIndex = fullSource.findIndex(t => t.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(fullSource, oldIndex, newIndex);
      reorderMutation.mutate({ status: sourceStatus, orderedIds: reordered.map(t => t.id) });
      return;
    }

    const fullTarget = groupedTickets.get(targetStatus) ?? [];
    const insertAt = fullTarget.findIndex(t => t.id === overId);
    if (insertAt === -1) return;

    const orderedIds = [
      ...fullTarget.slice(0, insertAt).map(t => t.id),
      activeId,
      ...fullTarget.slice(insertAt).map(t => t.id)
    ];

    reorderMutation.mutate({
      status: targetStatus,
      orderedIds,
      statusChange: { ticketId: activeId, newStatus: targetStatus }
    });
  }

  async function handleCreateTicket(
    status: string,
    objective: string,
    position: 'top' | 'bottom' = 'top'
  ) {
    const trimmed = objective.trim();
    if (!trimmed) return;

    const clientTicketId = crypto.randomUUID();
    const optimisticTicket = buildOptimisticTicket({
      id: clientTicketId,
      objective: trimmed,
      status,
      position,
      tickets,
      organizationId,
      projectId,
      defaultProject
    });

    await createTicketMutation.mutateAsync({
      optimisticTicket: toBoardTicket(optimisticTicket),
      status,
      objective: trimmed,
      organizationId,
      projectId: optimisticTicket.project_id ?? undefined,
      placement: position
    });
  }

  async function handleCreateAndOpenTicket(
    status: string,
    objective: string,
    position: 'top' | 'bottom' = 'top'
  ) {
    const trimmed = objective.trim();
    if (!trimmed) return;

    const clientTicketId = crypto.randomUUID();
    const optimisticTicket = buildOptimisticTicket({
      id: clientTicketId,
      objective: trimmed,
      status,
      position,
      tickets,
      organizationId,
      projectId,
      defaultProject
    });

    const result = await createTicketMutation.mutateAsync({
      optimisticTicket: toBoardTicket(optimisticTicket),
      status,
      objective: trimmed,
      organizationId,
      projectId: optimisticTicket.project_id ?? undefined,
      placement: position
    });

    const path = buildTicketPath({
      projectId: result.projectId,
      ticketId: result.id
    });
    router.push(path);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {showViewToggle || hasTickets ? (
        <TicketListToolbar
          initialView={initialView}
          projectId={projectId}
          showViewToggle={showViewToggle}
          hasTickets={hasTickets}
          sortKey={sortKey}
          statusFilterLabel={statusFilterLabel}
          areAllStatusesSelected={areAllStatusesSelected}
          statusFilterOptions={statusFilterOptions}
          selectedStatusesSet={selectedStatusesSet}
          projectOptions={projectOptions}
          filterProjectIds={filterProjectIds}
          tagOptions={tagOptions}
          selectedTagIds={filterTagIds}
          scheduledVisibilityDays={scheduledVisibilityDays}
          onSortKeyChange={setSortKey}
          onSelectAllStatuses={() => {
            setSelectedStatuses(statusFilterOptions);
            saveListFilters(statusFilterOptions, filterProjectIds, filterTagIds);
          }}
          onToggleStatus={toggleStatus}
          onToggleFilterProject={projectFilterId => {
            setFilterProjectIds(prev => {
              const next = prev.includes(projectFilterId)
                ? prev.filter(id => id !== projectFilterId)
                : [...prev, projectFilterId];
              queueMicrotask(() => {
                saveListFilters(selectedStatuses, next, filterTagIds);
              });
              return next;
            });
          }}
          onClearProjectFilters={() => {
            setFilterProjectIds([]);
            saveListFilters(selectedStatuses, [], filterTagIds);
          }}
          onToggleTag={toggleTag}
          onClearTagFilters={() => {
            setFilterTagIds([]);
            saveListFilters(selectedStatuses, filterProjectIds, []);
          }}
        />
      ) : null}
      {hasTickets ? (
        <DndContext id="tickets-list-dnd" sensors={sensors} onDragEnd={handleDndDragEnd}>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {orderedStatuses.map(status => {
              const rawGroupTickets = groupedTickets.get(status.name) ?? [];
              const groupTickets = tagsByTicketId
                ? rawGroupTickets.map(t => ({ ...t, tags: tagsByTicketId[t.id] ?? [] }))
                : rawGroupTickets;
              const style = getStatusStyle(status.status_type, status.name);
              const isExpanded = !!expandedStatuses[status.name];
              const isCollapsed = collapsedStatuses.has(status.name);
              const isDropTarget = !draggedStatusName && dropTargetStatus === status.name;
              const isReorderTarget =
                draggedStatusName && dropTargetStatusForReorder === status.name;
              const loadMoreState = statusLoadMoreStates.get(status.name);
              const hasMore =
                status.status_type === 'complete' &&
                (loadMoreState?.hasMore ??
                  (initialHasMoreByStatus.get(status.name) ?? 0) >= TICKETS_PAGE_SIZE);
              const isLoadingMore = loadMoreState?.isLoading ?? false;

              return (
                <TicketListStatusGroup
                  key={status.name}
                  status={status}
                  style={style}
                  tickets={groupTickets}
                  pathname={pathname}
                  ticketUrlBase={ticketUrlBase}
                  showOrganizationName={showOrganizationName}
                  projectId={projectId}
                  completeStatusName={completeStatusName}
                  isExpanded={isExpanded}
                  isCollapsed={isCollapsed}
                  isDropTarget={isDropTarget}
                  isReorderTarget={Boolean(isReorderTarget)}
                  activeBlankStatus={activeBlankStatus}
                  onToggleCollapse={toggleCollapse}
                  onToggleExpand={toggleExpand}
                  onSetActiveBlankStatus={setActiveBlankStatus}
                  onTicketDragOverStatus={handleTicketDragOverStatus}
                  onTicketDragLeaveStatus={handleTicketDragLeaveStatus}
                  onTicketDropOnStatus={handleTicketDropOnStatus}
                  onStatusDragStart={handleStatusDragStart}
                  onStatusDragEnd={handleStatusDragEnd}
                  onStatusDragOver={handleStatusDragOver}
                  onStatusDrop={handleStatusDrop}
                  onClearStatusReorderTarget={() => setDropTargetStatusForReorder(null)}
                  onTicketDragStart={handleTicketDragStart}
                  onTicketDragEnd={handleTicketDragEnd}
                  onCompleteTicket={handleCompleteTicket}
                  onMarkUnread={handleMarkUnread}
                  onCreateTicket={handleCreateTicket}
                  onCreateAndOpenTicket={handleCreateAndOpenTicket}
                  hasMore={hasMore}
                  isLoadingMore={isLoadingMore}
                  onLoadMore={() => void handleLoadMore(status.name)}
                />
              );
            })}
            {orderedStatuses.length > 0 ? (
              <div
                className={cn('shrink-0', draggedStatusName && 'min-h-14')}
                onDragOver={handleStatusDragOverEnd}
                onDragLeave={handleStatusDragLeaveEnd}
                onDrop={handleStatusDropEnd}
              >
                {draggedStatusName && dropTargetStatusForReorder === STATUS_REORDER_DROP_END ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                    Release to reorder here
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </DndContext>
      ) : (
        <Card>
          <CardContent className="pt-6">No tickets yet. Create the first one.</CardContent>
        </Card>
      )}
    </div>
  );
}
