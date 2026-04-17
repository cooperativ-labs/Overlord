'use client';

import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  createTicketStatusAction,
  deleteTicketStatusAction,
  reorderTicketStatusesAction,
  updateTicketStatusNameAction
} from '@/lib/actions/ticket-statuses';

import type { BoardStatus, TicketBoardState } from './board-types';
import { applyStatusListToBoards, restoreBoards, snapshotBoards } from './cache';
import { ticketQueryKeys } from './query-keys';

type StatusSnapshot = {
  statuses: BoardStatus[] | undefined;
  boards: [readonly unknown[], TicketBoardState][];
};

function snapshotStatusState(queryClient: QueryClient, organizationId: number): StatusSnapshot {
  return {
    statuses: queryClient.getQueryData<BoardStatus[]>(ticketQueryKeys.statuses(organizationId)),
    boards: snapshotBoards(queryClient)
  };
}

function restoreStatusState(
  queryClient: QueryClient,
  organizationId: number,
  snapshot: StatusSnapshot
) {
  queryClient.setQueryData(ticketQueryKeys.statuses(organizationId), snapshot.statuses);
  restoreBoards(queryClient, snapshot.boards);
}

function normalizeStatusName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function sortStatuses(statuses: BoardStatus[]): BoardStatus[] {
  return [...statuses].sort((left, right) => {
    if (left.position === right.position) return left.name.localeCompare(right.name);
    return left.position - right.position;
  });
}

function setStatuses(queryClient: QueryClient, organizationId: number, statuses: BoardStatus[]) {
  const sorted = sortStatuses(statuses);
  queryClient.setQueryData(ticketQueryKeys.statuses(organizationId), sorted);
  applyStatusListToBoards(queryClient, sorted);
}

function patchStatuses(
  queryClient: QueryClient,
  organizationId: number,
  updater: (statuses: BoardStatus[]) => BoardStatus[]
) {
  const current =
    queryClient.getQueryData<BoardStatus[]>(ticketQueryKeys.statuses(organizationId)) ?? [];
  setStatuses(queryClient, organizationId, updater(current));
}

function toBoardStatus(status: {
  name: string;
  position: number;
  statusType?: string;
  status_type?: string;
}): BoardStatus {
  return {
    name: status.name,
    position: status.position,
    status_type: status.status_type ?? status.statusType
  };
}

export function useCreateTicketStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTicketStatusAction,
    onMutate: input => {
      const snapshot = snapshotStatusState(queryClient, input.organizationId);
      patchStatuses(queryClient, input.organizationId, statuses => {
        const tailPosition = statuses.reduce(
          (maxPosition, status) => Math.max(maxPosition, status.position),
          -1
        );
        return [
          ...statuses,
          {
            name: normalizeStatusName(input.name),
            position: tailPosition + 1,
            status_type: input.statusType
          }
        ];
      });
      return snapshot;
    },
    onError: (_error, input, snapshot) => {
      if (snapshot) restoreStatusState(queryClient, input.organizationId, snapshot);
    },
    onSuccess: (created, input) => {
      const createdStatus = toBoardStatus(created);
      patchStatuses(queryClient, input.organizationId, statuses =>
        statuses.map(status =>
          status.name === normalizeStatusName(input.name) ? createdStatus : status
        )
      );
    }
  });
}

export function useDeleteTicketStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTicketStatusAction,
    onMutate: input => {
      const snapshot = snapshotStatusState(queryClient, input.organizationId);
      const name = normalizeStatusName(input.name);
      patchStatuses(queryClient, input.organizationId, statuses =>
        statuses.filter(status => status.name !== name)
      );
      return snapshot;
    },
    onError: (_error, input, snapshot) => {
      if (snapshot) restoreStatusState(queryClient, input.organizationId, snapshot);
    }
  });
}

export function useRenameTicketStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTicketStatusNameAction,
    onMutate: input => {
      const snapshot = snapshotStatusState(queryClient, input.organizationId);
      const currentName = normalizeStatusName(input.currentName);
      const nextName = normalizeStatusName(input.nextName);
      patchStatuses(queryClient, input.organizationId, statuses =>
        statuses.map(status =>
          status.name === currentName ? { ...status, name: nextName } : status
        )
      );
      return snapshot;
    },
    onError: (_error, input, snapshot) => {
      if (snapshot) restoreStatusState(queryClient, input.organizationId, snapshot);
    },
    onSuccess: (updated, input) => {
      if (!updated) return;
      const updatedStatus = toBoardStatus(updated);
      patchStatuses(queryClient, input.organizationId, statuses =>
        statuses.map(status =>
          status.name === normalizeStatusName(input.nextName) ? updatedStatus : status
        )
      );
    }
  });
}

export function useReorderTicketStatusesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reorderTicketStatusesAction,
    onMutate: input => {
      const snapshot = snapshotStatusState(queryClient, input.organizationId);
      const orderedNames = input.orderedNames.map(normalizeStatusName);
      patchStatuses(queryClient, input.organizationId, statuses =>
        orderedNames
          .map((name, position) => {
            const existing = statuses.find(status => status.name === name);
            return existing ? { ...existing, position } : null;
          })
          .filter((status): status is BoardStatus => status !== null)
      );
      return snapshot;
    },
    onError: (_error, input, snapshot) => {
      if (snapshot) restoreStatusState(queryClient, input.organizationId, snapshot);
    },
    onSuccess: (statuses, input) => {
      setStatuses(queryClient, input.organizationId, statuses.map(toBoardStatus));
    }
  });
}
