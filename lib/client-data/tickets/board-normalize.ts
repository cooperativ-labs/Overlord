import type {
  BoardBootstrap,
  BoardStatus,
  BoardTicket,
  ColumnPageInfo,
  TicketBoardState
} from './board-types';

export function indexById<T extends { id: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const row of rows) out[row.id] = row;
  return out;
}

export function indexStatusesByName(statuses: BoardStatus[]): Record<string, BoardStatus> {
  const out: Record<string, BoardStatus> = {};
  for (const status of statuses) out[status.name] = status;
  return out;
}

export function emptyColumnPageInfo(): ColumnPageInfo {
  return { cutoff: null, hasMore: false };
}

export function normalizeBoardBootstrap(bootstrap: BoardBootstrap): TicketBoardState {
  const ticketsById = indexById(bootstrap.tickets);
  const ticketStatusesByName = indexStatusesByName(bootstrap.statuses);

  const waitingByTicketId: TicketBoardState['waitingByTicketId'] = {};
  for (const ticket of bootstrap.tickets) {
    if (ticket.waiting_for_response_at) {
      waitingByTicketId[ticket.id] = { raisedAt: ticket.waiting_for_response_at };
    }
  }

  return {
    scope: bootstrap.scope,
    ticketsById,
    columnPageInfoByStatus: bootstrap.columnPageInfo ?? {},
    ticketStatusesByName,
    waitingByTicketId,
    objectiveMetaByTicketId: {},
    agentSessionsByTicketId: {},
    pendingMutationsByEntityId: {}
  };
}

export function emptyBoardState(scope: TicketBoardState['scope']): TicketBoardState {
  return {
    scope,
    ticketsById: {},
    columnPageInfoByStatus: {},
    ticketStatusesByName: {},
    waitingByTicketId: {},
    objectiveMetaByTicketId: {},
    agentSessionsByTicketId: {},
    pendingMutationsByEntityId: {}
  };
}

// Shallow-merge an incoming ticket row over an existing one. Used by both
// bootstrap reconciliation and realtime/poll merges. Field-level: caller is
// responsible for guarding against stale rows.
export function mergeTicketFields(
  existing: BoardTicket,
  incoming: Partial<BoardTicket>
): BoardTicket {
  return { ...existing, ...incoming };
}
