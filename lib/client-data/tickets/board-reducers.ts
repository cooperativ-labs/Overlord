import { mergeTicketFields } from './board-normalize';
import type {
  BoardStatus,
  BoardTicket,
  PendingMutation,
  TicketBoardState,
  TicketRowSource
} from './board-types';

// All reducers are pure: they take the current state and return a new state
// without mutating the input. Reducers do not import React, Supabase, Next.js,
// or TanStack Query.

export type ColumnPlacement = 'top' | 'bottom';

function withTicket(state: TicketBoardState, ticket: BoardTicket): TicketBoardState {
  return {
    ...state,
    ticketsById: { ...state.ticketsById, [ticket.id]: ticket }
  };
}

function withoutTicket(state: TicketBoardState, ticketId: string): TicketBoardState {
  if (!(ticketId in state.ticketsById)) return state;
  const nextTickets = { ...state.ticketsById };
  delete nextTickets[ticketId];

  let nextWaiting = state.waitingByTicketId;
  if (ticketId in nextWaiting) {
    nextWaiting = { ...nextWaiting };
    delete nextWaiting[ticketId];
  }

  let nextPending = state.pendingMutationsByEntityId;
  if (ticketId in nextPending) {
    nextPending = { ...nextPending };
    delete nextPending[ticketId];
  }

  return {
    ...state,
    ticketsById: nextTickets,
    waitingByTicketId: nextWaiting,
    pendingMutationsByEntityId: nextPending
  };
}

function getColumnTicketsRaw(state: TicketBoardState, status: string): BoardTicket[] {
  const matching: BoardTicket[] = [];
  for (const ticket of Object.values(state.ticketsById)) {
    if (ticket.status === status) matching.push(ticket);
  }
  return matching;
}

function nextBoardPositionForPlacement(
  state: TicketBoardState,
  status: string,
  placement: ColumnPlacement,
  excludeTicketId?: string
): number {
  const inColumn = getColumnTicketsRaw(state, status).filter(t => t.id !== excludeTicketId);
  if (inColumn.length === 0) return 0;
  if (placement === 'top') {
    let min = Number.POSITIVE_INFINITY;
    for (const t of inColumn) min = Math.min(min, t.board_position);
    return Number.isFinite(min) ? min - 1 : 0;
  }
  let max = Number.NEGATIVE_INFINITY;
  for (const t of inColumn) max = Math.max(max, t.board_position);
  return Number.isFinite(max) ? max + 1 : 0;
}

export function insertOptimisticTicket(
  state: TicketBoardState,
  ticket: BoardTicket,
  options?: { placement?: ColumnPlacement; mutationId?: string; submittedAt?: string }
): TicketBoardState {
  const placement = options?.placement ?? 'top';
  const board_position = nextBoardPositionForPlacement(state, ticket.status, placement);
  const optimistic: BoardTicket = { ...ticket, board_position };
  let next = withTicket(state, optimistic);
  if (options?.mutationId) {
    next = withPendingMutation(next, optimistic.id, {
      mutationId: options.mutationId,
      kind: 'create',
      submittedAt: options.submittedAt ?? new Date(0).toISOString()
    });
  }
  return next;
}

export function deleteTicket(state: TicketBoardState, ticketId: string): TicketBoardState {
  return withoutTicket(state, ticketId);
}

export function updateTicketFields(
  state: TicketBoardState,
  ticketId: string,
  patch: Partial<BoardTicket>
): TicketBoardState {
  const existing = state.ticketsById[ticketId];
  if (!existing) return state;
  return withTicket(state, mergeTicketFields(existing, patch));
}

export function moveTicketBetweenStatuses(
  state: TicketBoardState,
  ticketId: string,
  nextStatus: string,
  placement: ColumnPlacement = 'top'
): TicketBoardState {
  const existing = state.ticketsById[ticketId];
  if (!existing) return state;
  if (existing.status === nextStatus) return state;
  const board_position = nextBoardPositionForPlacement(state, nextStatus, placement, ticketId);
  return withTicket(state, { ...existing, status: nextStatus, board_position });
}

export function reorderTicketsInColumn(
  state: TicketBoardState,
  status: string,
  orderedIds: string[]
): TicketBoardState {
  const positionMap = new Map<string, number>();
  for (let i = 0; i < orderedIds.length; i++) positionMap.set(orderedIds[i], i);

  const nextTickets = { ...state.ticketsById };
  let changed = false;
  for (const ticket of Object.values(state.ticketsById)) {
    if (!positionMap.has(ticket.id)) continue;
    const nextPos = positionMap.get(ticket.id)!;
    const nextStatus = ticket.status === status ? status : status;
    if (ticket.board_position !== nextPos || ticket.status !== nextStatus) {
      nextTickets[ticket.id] = { ...ticket, board_position: nextPos, status: nextStatus };
      changed = true;
    }
  }
  return changed ? { ...state, ticketsById: nextTickets } : state;
}

export function markTicketRead(
  state: TicketBoardState,
  ticketId: string,
  isRead: boolean
): TicketBoardState {
  const existing = state.ticketsById[ticketId];
  if (!existing) return state;
  if (existing.is_read === isRead) return state;
  return withTicket(state, { ...existing, is_read: isRead });
}

// Merge an authoritative server ticket row. Newer `updated_at` wins; if the
// existing row has a more recent updated_at we ignore the merge to avoid
// clobbering optimistic local state with a stale snapshot.
export function mergeServerTicketRow(
  state: TicketBoardState,
  row: BoardTicket,
  source: TicketRowSource = 'server-mutation'
): TicketBoardState {
  const existing = state.ticketsById[row.id];
  if (!existing) {
    // Bootstrap/poll/realtime can introduce previously-unknown tickets.
    let next = withTicket(state, row);
    if (row.waiting_for_response_at) {
      next = mergeWaitingQuestion(next, {
        ticket_id: row.id,
        created_at: row.waiting_for_response_at,
        is_blocking: true
      });
    }
    return next;
  }
  if (source !== 'server-mutation' && isStaleUpdate(existing.updated_at, row.updated_at)) {
    return state;
  }
  return withTicket(state, mergeTicketFields(existing, row));
}

export function mergeRealtimeTicketRow(
  state: TicketBoardState,
  row: Partial<BoardTicket> & { id: string }
): TicketBoardState {
  const existing = state.ticketsById[row.id];
  if (!existing) return state;
  if (isStaleUpdate(existing.updated_at, row.updated_at)) return state;
  return withTicket(state, mergeTicketFields(existing, row));
}

export function reconcileRemovedTicket(
  state: TicketBoardState,
  ticketId: string
): TicketBoardState {
  return withoutTicket(state, ticketId);
}

export function mergeWaitingQuestion(
  state: TicketBoardState,
  event: { ticket_id: string; created_at: string; is_blocking?: boolean }
): TicketBoardState {
  if (event.is_blocking === false) return state;
  const existing = state.waitingByTicketId[event.ticket_id];
  if (existing && Date.parse(existing.raisedAt) >= Date.parse(event.created_at)) return state;
  return {
    ...state,
    waitingByTicketId: {
      ...state.waitingByTicketId,
      [event.ticket_id]: { raisedAt: event.created_at }
    }
  };
}

export function clearWaitingQuestion(state: TicketBoardState, ticketId: string): TicketBoardState {
  if (!(ticketId in state.waitingByTicketId)) return state;
  const next = { ...state.waitingByTicketId };
  delete next[ticketId];
  return { ...state, waitingByTicketId: next };
}

export function applyStatusListChange(
  state: TicketBoardState,
  statuses: BoardStatus[]
): TicketBoardState {
  const next: Record<string, BoardStatus> = {};
  for (const status of statuses) next[status.name] = status;
  return { ...state, ticketStatusesByName: next };
}

export function renameTicketStatus(
  state: TicketBoardState,
  currentName: string,
  nextStatus: BoardStatus
): TicketBoardState {
  const nextStatuses = { ...state.ticketStatusesByName };
  delete nextStatuses[currentName];
  nextStatuses[nextStatus.name] = nextStatus;

  let changedTickets = false;
  const nextTickets = { ...state.ticketsById };
  for (const ticket of Object.values(state.ticketsById)) {
    if (ticket.status !== currentName) continue;
    nextTickets[ticket.id] = { ...ticket, status: nextStatus.name };
    changedTickets = true;
  }

  return {
    ...state,
    ticketStatusesByName: nextStatuses,
    ticketsById: changedTickets ? nextTickets : state.ticketsById
  };
}

export function withPendingMutation(
  state: TicketBoardState,
  entityId: string,
  mutation: PendingMutation
): TicketBoardState {
  const current = state.pendingMutationsByEntityId[entityId] ?? [];
  return {
    ...state,
    pendingMutationsByEntityId: {
      ...state.pendingMutationsByEntityId,
      [entityId]: [...current, mutation]
    }
  };
}

export function clearPendingMutation(
  state: TicketBoardState,
  entityId: string,
  mutationId: string
): TicketBoardState {
  const current = state.pendingMutationsByEntityId[entityId];
  if (!current || current.length === 0) return state;
  const remaining = current.filter(m => m.mutationId !== mutationId);
  const nextMap = { ...state.pendingMutationsByEntityId };
  if (remaining.length === 0) delete nextMap[entityId];
  else nextMap[entityId] = remaining;
  return { ...state, pendingMutationsByEntityId: nextMap };
}

function isStaleUpdate(
  existingUpdatedAt: string | undefined,
  incomingUpdatedAt: string | undefined
): boolean {
  if (!existingUpdatedAt || !incomingUpdatedAt) return false;
  return Date.parse(incomingUpdatedAt) < Date.parse(existingUpdatedAt);
}
