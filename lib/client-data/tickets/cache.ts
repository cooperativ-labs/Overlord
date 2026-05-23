'use client';

import type { QueryClient } from '@tanstack/react-query';

import {
  applyStatusListChange,
  clearWaitingQuestion,
  mergeRealtimeTicketRow,
  mergeServerTicketRow,
  mergeWaitingQuestion,
  reconcileRemovedTicket,
  updateTicketFields
} from './board-reducers';
import type { BoardStatus, BoardTicket, TicketBoardState, TicketRowSource } from './board-types';

export type BoardEntry = [readonly unknown[], TicketBoardState];

const BOARD_QUERY_FILTER = { queryKey: ['tickets', 'board'] as const };

function boardCanContainTicket(
  state: TicketBoardState,
  ticket: Pick<BoardTicket, 'project_id' | 'organization_id'>
) {
  if (state.scope.kind === 'project') {
    return state.scope.projectId === ticket.project_id;
  }

  return (
    state.scope.organizationId === undefined ||
    state.scope.organizationId === ticket.organization_id
  );
}

export function getBoardEntries(qc: QueryClient): BoardEntry[] {
  const entries = qc.getQueriesData<TicketBoardState>(BOARD_QUERY_FILTER);
  const live: BoardEntry[] = [];
  for (const [key, state] of entries) {
    if (state) live.push([key, state]);
  }
  return live;
}

export function snapshotBoards(qc: QueryClient): BoardEntry[] {
  return getBoardEntries(qc).map(([key, state]) => [key, state] as BoardEntry);
}

export function restoreBoards(qc: QueryClient, snapshot: BoardEntry[]): void {
  for (const [key, state] of snapshot) {
    qc.setQueryData(key, state);
  }
}

export function applyToAllBoards(
  qc: QueryClient,
  updater: (state: TicketBoardState) => TicketBoardState
): void {
  qc.setQueriesData<TicketBoardState>(BOARD_QUERY_FILTER, state => {
    if (!state) return state;
    return updater(state);
  });
}

export function applyToBoardsContainingTicket(
  qc: QueryClient,
  ticket: Pick<BoardTicket, 'project_id' | 'organization_id'>,
  updater: (state: TicketBoardState) => TicketBoardState
): void {
  qc.setQueriesData<TicketBoardState>(BOARD_QUERY_FILTER, state => {
    if (!state) return state;
    if (!boardCanContainTicket(state, ticket)) return state;
    return updater(state);
  });
}

export function mergeTicketsIntoBoards(
  qc: QueryClient,
  tickets: BoardTicket[],
  source: TicketRowSource = 'server-poll'
): void {
  if (tickets.length === 0) return;
  applyToAllBoards(qc, state => {
    let next = state;
    for (const ticket of tickets) {
      if (!boardCanContainTicket(next, ticket)) continue;
      next = mergeServerTicketRow(next, ticket, source);
    }
    return next;
  });
}

export function reconcileServerTicketRow(
  qc: QueryClient,
  row: BoardTicket,
  source: TicketRowSource = 'server-mutation'
): void {
  applyToBoardsContainingTicket(qc, row, state => mergeServerTicketRow(state, row, source));
}

export function reconcileRealtimeTicketRow(
  qc: QueryClient,
  row: Partial<BoardTicket> & { id: string }
): void {
  applyToAllBoards(qc, state => mergeRealtimeTicketRow(state, row));
}

export function updateTicketInBoards(
  qc: QueryClient,
  ticketId: string,
  patch: Partial<BoardTicket>
): void {
  applyToAllBoards(qc, state => updateTicketFields(state, ticketId, patch));
}

export function moveTicketProjectInBoards(
  qc: QueryClient,
  ticketId: string,
  patch: Partial<BoardTicket> & Pick<BoardTicket, 'project_id'>
): void {
  applyToAllBoards(qc, state => {
    if (state.scope.kind === 'project' && state.scope.projectId !== patch.project_id) {
      return reconcileRemovedTicket(state, ticketId);
    }
    return updateTicketFields(state, ticketId, patch);
  });
}

export function removeTicketFromBoards(qc: QueryClient, ticketId: string): void {
  applyToAllBoards(qc, state => reconcileRemovedTicket(state, ticketId));
}

export function mergeWaitingQuestionIntoBoards(
  qc: QueryClient,
  event: { ticket_id: string; created_at: string; is_blocking?: boolean }
): void {
  applyToAllBoards(qc, state => mergeWaitingQuestion(state, event));
}

export function clearWaitingQuestionFromBoards(qc: QueryClient, ticketId: string): void {
  applyToAllBoards(qc, state => clearWaitingQuestion(state, ticketId));
}

export function applyStatusListToBoards(qc: QueryClient, statuses: BoardStatus[]): void {
  applyToAllBoards(qc, state => applyStatusListChange(state, statuses));
}
