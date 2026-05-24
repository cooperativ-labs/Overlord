import type { BoardStatus, BoardTicket, TicketBoardState } from './board-types';

// Stable, derived views over the normalized board state. Selectors must remain
// pure and synchronous so they can be reused across desktop/web shells and
// safely memoized at the call site.

export function selectAllTickets(state: TicketBoardState): BoardTicket[] {
  return Object.values(state.ticketsById);
}

export function selectTicketById(
  state: TicketBoardState,
  ticketId: string
): BoardTicket | undefined {
  return state.ticketsById[ticketId];
}

export function selectStatusesSorted(state: TicketBoardState): BoardStatus[] {
  return Object.values(state.ticketStatusesByName)
    .slice()
    .sort((a, b) => a.position - b.position);
}

export type SortedColumns = {
  groups: Map<string, BoardTicket[]>;
  uncategorized: BoardTicket[];
};

// Mirrors the existing KanbanBoard grouping/sort behavior. All columns sort
// strictly by board_position.
export function selectColumnGroups(state: TicketBoardState): SortedColumns {
  const sortedColumns = selectStatusesSorted(state);
  const groups = new Map<string, BoardTicket[]>();
  for (const col of sortedColumns) groups.set(col.name, []);
  const uncategorized: BoardTicket[] = [];

  for (const ticket of Object.values(state.ticketsById)) {
    const bucket = groups.get(ticket.status);
    if (bucket) bucket.push(ticket);
    else uncategorized.push(ticket);
  }

  for (const [name, bucket] of groups) {
    bucket.sort((a, b) => a.board_position - b.board_position);
  }
  uncategorized.sort((a, b) => a.board_position - b.board_position);

  return { groups, uncategorized };
}

export function selectColumnTickets(state: TicketBoardState, status: string): BoardTicket[] {
  return selectColumnGroups(state).groups.get(status) ?? [];
}

export function selectWaitingTickets(state: TicketBoardState): string[] {
  return Object.keys(state.waitingByTicketId);
}

export function selectIsWaiting(state: TicketBoardState, ticketId: string): boolean {
  return Boolean(state.waitingByTicketId[ticketId]);
}

export function selectPendingMutations(state: TicketBoardState, ticketId: string) {
  return state.pendingMutationsByEntityId[ticketId] ?? [];
}
