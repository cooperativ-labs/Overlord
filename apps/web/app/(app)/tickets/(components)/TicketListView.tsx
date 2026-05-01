'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpDown,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Eye,
  Filter,
  GripVertical,
  NotebookPen,
  Play,
  Plus
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { upsertGlobalListViewPreferencesAction } from '@/lib/actions/global-list-view-preferences';
import { upsertProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { selectAllTickets } from '@/lib/client-data/tickets/board-selectors';
import { useTicketBoard } from '@/lib/client-data/tickets/hooks';
import {
  useCreateTicketMutation,
  useMarkTicketReadMutation,
  useUpdateTicketStatusMutation
} from '@/lib/client-data/tickets/mutations';
import {
  normalizeStringList,
  normalizeTicketListFilters,
  parseTicketListFilters,
  type TicketListFilters
} from '@/lib/helpers/ticket-list-filters';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import {
  getWaitingRaisedWhileOpenMap,
  markTicketWaitingOpened
} from '@/lib/helpers/ticket-waiting-response';
import { cn } from '@/lib/utils';

import BlankTicketCard from './BlankTicketCard';
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
import TicketListCard from './TicketListCard';
import TicketsViewControls from './TicketsViewControls';
import { useTicketBoardRealtime } from './useTicketBoardRealtime';

const EMPTY_FILE_MENTION_PATHS: string[] = [];

type SortKey = 'updated_at' | 'status' | 'priority';

const SORT_LABELS: Record<SortKey, string> = {
  updated_at: 'Last updated',
  status: 'Status',
  priority: 'Priority'
};

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];
const DEFAULT_SELECTED_STATUSES = ['draft', 'execute', 'review'] as const;
const USER_LIST_FILTERS_KEY = 'overlord:user-ticket-list-filters';
const PERSONAL_PROJECT_FILTER_ID = '__personal__';
const SHOW_MORE_THRESHOLD = 4;
const SCROLL_THRESHOLD = 12;

function areStringListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readStoredListFilters(): TicketListFilters | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(USER_LIST_FILTERS_KEY);
    if (!stored) return null;
    return parseTicketListFilters(JSON.parse(stored));
  } catch {
    return null;
  }
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

type StatusStyle = {
  text: string;
  bg: string;
  rule: string;
  icon: React.ComponentType<{ className?: string }>;
};

function getStatusStyle(statusType: string | undefined, statusName: string): StatusStyle {
  if (statusType === 'execute')
    return { text: 'text-blue-500', bg: 'bg-blue-500/15', rule: 'bg-blue-500/30', icon: Play };
  if (statusType === 'complete')
    return {
      text: 'text-emerald-500',
      bg: 'bg-emerald-500/15',
      rule: 'bg-emerald-500/30',
      icon: CheckCheck
    };
  if (statusType === 'review')
    return { text: 'text-cyan-500', bg: 'bg-cyan-500/15', rule: 'bg-cyan-500/30', icon: Eye };
  if (statusName === 'draft')
    return {
      text: 'text-muted-foreground',
      bg: 'bg-muted',
      rule: 'bg-border',
      icon: NotebookPen
    };
  // next-up / other
  return {
    text: 'text-sky-600 dark:text-sky-400',
    bg: 'bg-sky-500/15',
    rule: 'bg-sky-500/30',
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
  initialStatusOrder
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
  const { mutate: markTicketRead } = useMarkTicketReadMutation();
  const { defaultProject } = useDefaultProject();

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
  const [filterProject, setFilterProject] = useState<string | null>(() =>
    projectId
      ? null
      : (initialListFilters?.filter_project_id ?? storedListFilters?.filter_project_id ?? null)
  );

  const [expandedStatuses, setExpandedStatuses] = useState<Record<string, boolean>>({});
  const [collapsedStatuses, setCollapsedStatuses] = useState<Set<string>>(
    () => new Set(initialCollapsedStatuses ?? [])
  );
  const [customStatusOrder, setCustomStatusOrder] = useState<string[] | null>(() =>
    initialStatusOrder && initialStatusOrder.length > 0 ? [...initialStatusOrder] : null
  );

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
    setWaitingRaisedWhileOpen
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

  const projectOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string | null }>();
    for (const t of tickets) {
      const optionId = t.project_id ?? PERSONAL_PROJECT_FILTER_ID;
      if (!seen.has(optionId)) {
        seen.set(optionId, {
          id: optionId,
          name: t.project_name ?? t.project_id ?? 'Personal',
          color: t.project_color ?? null
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tickets]);

  const saveListFilters = useCallback(
    (nextSelectedStatuses: string[], nextFilterProject: string | null) => {
      const nextFilters = normalizeTicketListFilters({
        selected_statuses: nextSelectedStatuses,
        filter_project_id: projectId ? null : nextFilterProject
      });

      if (projectId) {
        startTransition(() => {
          void upsertProjectUserPreferencesAction(projectId, { list_filters: nextFilters });
        });
        return;
      }

      try {
        localStorage.setItem(USER_LIST_FILTERS_KEY, JSON.stringify(nextFilters));
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
  const areAllStatusesSelected = uniqueStatuses.every(status => selectedStatusesSet.has(status));
  const statusFilterLabel = useMemo(() => {
    if (selectedStatuses.length === 0) return 'All statuses';
    if (areAllStatusesSelected || uniqueStatuses.length === 0) return 'All statuses';
    if (selectedStatuses.length === 1) return formatStatusLabel(selectedStatuses[0] ?? '');
    if (selectedStatuses.length <= 2) return selectedStatuses.map(formatStatusLabel).join(', ');
    return `${selectedStatuses.length} statuses`;
  }, [areAllStatusesSelected, uniqueStatuses.length, selectedStatuses]);

  function toggleStatus(status: string) {
    setSelectedStatuses(current => {
      const next = current.includes(status)
        ? current.filter(currentStatus => currentStatus !== status)
        : [...current, status];
      saveListFilters(next, filterProject);
      return next;
    });
  }

  // Filter then sort flat — grouping happens at render time.
  const filteredSortedTickets = useMemo(() => {
    let filtered = ticketsWithIndicators;
    if (!areAllStatusesSelected && selectedStatuses.length > 0) {
      filtered = filtered.filter(t => selectedStatusesSet.has(t.status));
    }
    if (filterProject) {
      filtered = filtered.filter(t =>
        filterProject === PERSONAL_PROJECT_FILTER_ID
          ? t.project_id === null
          : t.project_id === filterProject
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
    filterProject
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
    return groups;
  }, [orderedStatuses, filteredSortedTickets]);

  const hasTickets = tickets.length > 0;

  useEffect(() => {
    setSelectedStatuses(current => {
      const next = sanitizeSelectedStatuses(current, uniqueStatuses);
      if (areStringListsEqual(current, next)) return current;
      saveListFilters(next, filterProject);
      return next;
    });
  }, [filterProject, saveListFilters, uniqueStatuses]);

  useEffect(() => {
    if (projectId) return;
    if (filterProject === null) return;
    if (projectOptions.some(project => project.id === filterProject)) return;
    saveListFilters(selectedStatuses, null);
    setFilterProject(null);
  }, [filterProject, projectId, projectOptions, saveListFilters, selectedStatuses]);

  function toggleExpand(statusName: string) {
    setExpandedStatuses(prev => ({ ...prev, [statusName]: !prev[statusName] }));
  }

  function toggleCollapse(statusName: string) {
    setCollapsedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(statusName)) {
        next.delete(statusName);
      } else {
        next.add(statusName);
      }
      saveStatusViewPreferences([...next], customStatusOrder ?? orderedStatuses.map(s => s.name));
      return next;
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
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetStatusForReorder(statusName);
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

    if (fromIndex !== -1 && toIndex !== -1) {
      const newOrder = [...currentOrder];
      newOrder.splice(fromIndex, 1);
      const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
      newOrder.splice(insertAt, 0, draggedStatusName);
      setCustomStatusOrder(newOrder);
      saveStatusViewPreferences([...collapsedStatuses], newOrder);
    }

    setDraggedStatusName(null);
    setDropTargetStatusForReorder(null);
  }

  function handleStatusDragEnd() {
    setDraggedStatusName(null);
    setDropTargetStatusForReorder(null);
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
        <div className="flex w-full flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {showViewToggle ? (
              <TicketsViewControls initialView={initialView} projectId={projectId} />
            ) : null}
            {hasTickets ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <ArrowUpDown className="h-3.5 w-3.5" />
                      {SORT_LABELS[sortKey]}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
                      <DropdownMenuItem key={key} onClick={() => setSortKey(key)} className="gap-2">
                        {SORT_LABELS[key]}
                        {sortKey === key && <Check className="ml-auto h-4 w-4" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Filter className="h-3.5 w-3.5" />
                      {statusFilterLabel}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={areAllStatusesSelected}
                      onCheckedChange={() => {
                        setSelectedStatuses(uniqueStatuses);
                        saveListFilters(uniqueStatuses, filterProject);
                      }}
                      onSelect={event => event.preventDefault()}
                    >
                      All statuses
                    </DropdownMenuCheckboxItem>
                    {uniqueStatuses.map(status => (
                      <DropdownMenuCheckboxItem
                        key={status}
                        checked={selectedStatusesSet.has(status)}
                        onCheckedChange={() => toggleStatus(status)}
                        onSelect={event => event.preventDefault()}
                      >
                        {formatStatusLabel(status)}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {projectOptions.length > 1 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1.5">
                        {filterProject
                          ? (projectOptions.find(p => p.id === filterProject)?.name ?? 'Project')
                          : 'All projects'}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      <DropdownMenuLabel>Filter by project</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          setFilterProject(null);
                          saveListFilters(selectedStatuses, null);
                        }}
                        className="gap-2"
                      >
                        All projects
                        {filterProject === null && <Check className="ml-auto h-4 w-4" />}
                      </DropdownMenuItem>
                      {projectOptions.map(p => (
                        <DropdownMenuItem
                          key={p.id}
                          onClick={() => {
                            setFilterProject(p.id);
                            saveListFilters(selectedStatuses, p.id);
                          }}
                          className="gap-2"
                        >
                          {p.color && (
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                              style={{ backgroundColor: p.color, borderColor: p.color }}
                            />
                          )}
                          <span className="truncate">{p.name}</span>
                          {filterProject === p.id && <Check className="ml-auto h-4 w-4" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {hasTickets ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {orderedStatuses.map(status => {
            const groupTickets = groupedTickets.get(status.name) ?? [];
            const style = getStatusStyle(status.status_type, status.name);
            const StatusIcon = style.icon;
            const hasRunning = groupTickets.some(t => t.has_executing_objective === true);
            const hasAttention = groupTickets.some(
              t => t.is_read === false || t.has_unopened_waiting_response === true
            );
            const isExpanded = !!expandedStatuses[status.name];
            const isCollapsed = collapsedStatuses.has(status.name);
            const isDropTarget = !draggedStatusName && dropTargetStatus === status.name;
            const isReorderTarget = draggedStatusName && dropTargetStatusForReorder === status.name;
            const shouldScroll = isExpanded && groupTickets.length >= SCROLL_THRESHOLD;
            const visibleTickets =
              isExpanded || groupTickets.length <= SHOW_MORE_THRESHOLD
                ? groupTickets
                : groupTickets.slice(0, SHOW_MORE_THRESHOLD);
            const hiddenCount = groupTickets.length - SHOW_MORE_THRESHOLD;

            return (
              <div
                key={status.name}
                className={cn(
                  'flex flex-col gap-1',
                  isDropTarget && 'rounded-md bg-accent/30',
                  isReorderTarget &&
                    'rounded-md outline outline-1 outline-dashed outline-blue-500/50'
                )}
                onDragOver={e => {
                  handleTicketDragOverStatus(e, status.name);
                  handleStatusDragOver(e, status.name);
                }}
                onDragLeave={e => {
                  handleTicketDragLeaveStatus(e, status.name);
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    if (dropTargetStatusForReorder === status.name) {
                      setDropTargetStatusForReorder(null);
                    }
                  }
                }}
                onDrop={e => {
                  handleTicketDropOnStatus(e, status.name);
                  handleStatusDrop(e, status.name);
                }}
              >
                {/* Stage header */}
                <div
                  onDragOver={e => handleTicketDragOverStatus(e, status.name)}
                  onDragLeave={e => handleTicketDragLeaveStatus(e, status.name)}
                  onDrop={e => handleTicketDropOnStatus(e, status.name)}
                  className={cn(
                    'group/header flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors',
                    isDropTarget && 'bg-accent outline outline-1 outline-dashed outline-blue-500/50'
                  )}
                >
                  {/* Drag handle for reordering statuses */}
                  <div
                    draggable
                    onDragStart={e => handleStatusDragStart(e, status.name)}
                    onDragEnd={handleStatusDragEnd}
                    className="cursor-grab touch-none opacity-0 transition-opacity group-hover/header:opacity-100 active:cursor-grabbing"
                    title="Drag to reorder"
                    aria-label={`Reorder ${formatStatusLabel(status.name)}`}
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground" />
                  </div>

                  <div
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded',
                      style.bg,
                      style.text
                    )}
                  >
                    <StatusIcon className="h-3 w-3" />
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleCollapse(status.name)}
                    className={cn(
                      'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-70',
                      style.text
                    )}
                    title={
                      isCollapsed
                        ? `Expand ${formatStatusLabel(status.name)}`
                        : `Collapse ${formatStatusLabel(status.name)}`
                    }
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    {formatStatusLabel(status.name)}
                  </button>
                  {hasRunning && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_4px_rgb(16,185,129)]"
                      title="Agent running in this stage"
                    />
                  )}
                  {hasAttention && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500"
                      title="Tickets need attention"
                    />
                  )}
                  {isDropTarget && (
                    <span className="text-[10px] text-blue-500">
                      Drop to move to {formatStatusLabel(status.name)}
                    </span>
                  )}
                  <div className={cn('h-px flex-1', style.rule)} />
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {groupTickets.length}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={() => setActiveBlankStatus(status.name)}
                    aria-label={`Add ticket to ${formatStatusLabel(status.name)}`}
                    title={`Add ticket to ${formatStatusLabel(status.name)}`}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>

                {/* Cards body — hidden when collapsed */}
                {!isCollapsed && (
                  <div
                    onDragOver={e => handleTicketDragOverStatus(e, status.name)}
                    onDragLeave={e => handleTicketDragLeaveStatus(e, status.name)}
                    onDrop={e => handleTicketDropOnStatus(e, status.name)}
                    className={cn(
                      'ml-2 border-l border-border pl-2',
                      isDropTarget && 'rounded-r-md border-blue-500/50 bg-accent/40',
                      shouldScroll && 'pr-1'
                    )}
                    style={shouldScroll ? { maxHeight: 320, overflowY: 'auto' } : undefined}
                  >
                    {activeBlankStatus === status.name && (
                      <div className="mb-1">
                        <BlankTicketCard
                          inputId={`list-blank-card-${status.name}`}
                          status={status.name}
                          position="top"
                          fileMentionPaths={EMPTY_FILE_MENTION_PATHS}
                          onCreateTicket={handleCreateTicket}
                          onCreateAndOpenTicket={handleCreateAndOpenTicket}
                          onClose={() => setActiveBlankStatus(null)}
                        />
                      </div>
                    )}
                    {groupTickets.length === 0 && activeBlankStatus !== status.name ? (
                      <div className="rounded-md border border-dashed border-border px-3 py-2 text-center text-[11px] text-muted-foreground">
                        No tickets — drag one here or click + to add
                      </div>
                    ) : groupTickets.length === 0 ? null : (
                      <div className="flex flex-col gap-0.5">
                        {visibleTickets.map(ticket => {
                          const ticketPath = ticketUrlBase
                            ? `${ticketUrlBase}/${ticket.id}`
                            : buildTicketPath({
                                projectId: ticket.project_id,
                                ticketId: ticket.id
                              });
                          const isSelected = pathname === ticketPath;
                          return (
                            <TicketListCard
                              key={ticket.id}
                              ticket={ticket}
                              ticketPath={ticketPath}
                              isSelected={isSelected}
                              showOrganizationName={showOrganizationName}
                              showProjectName={!projectId}
                              onMarkUnread={handleMarkUnread}
                              onDragStart={handleTicketDragStart}
                              onDragEnd={handleTicketDragEnd}
                            />
                          );
                        })}
                        {!isExpanded && hiddenCount > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(status.name)}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                          >
                            <ChevronDown className="h-3 w-3" />
                            {hiddenCount} more
                          </button>
                        )}
                        {isExpanded && groupTickets.length > SHOW_MORE_THRESHOLD && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(status.name)}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                          >
                            <ChevronUp className="h-3 w-3" />
                            Show less
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">No tickets yet. Create the first one.</CardContent>
        </Card>
      )}
    </div>
  );
}
