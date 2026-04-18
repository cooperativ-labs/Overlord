'use client';

// Read-only Phase 2 hooks.
//
// These expose the server-rendered bootstrap through TanStack Query so
// components can migrate off per-page `useState` without changing behavior.
// Each hook accepts `initialData` and a high `staleTime`, so no network
// request is made unless an invalidation fires. Phase 3 wires real fetchers
// for background refetch and mutations.

import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';

import type { SidebarProject } from '@/lib/actions/projects';

import { normalizeBoardBootstrap } from './board-normalize';
import type {
  BoardBootstrap,
  BoardDataset,
  BoardScope,
  BoardStatus,
  TicketBoardState
} from './board-types';
import { defaultBoardFetcher, defaultProjectsFetcher, defaultStatusesFetcher } from './fetchers';
import { ticketQueryKeys } from './query-keys';

type ReadOnlyQueryOptions<TData> = Pick<
  UseQueryOptions<TData, Error, TData>,
  'enabled' | 'staleTime' | 'refetchOnMount' | 'refetchInterval'
>;

export type TicketBoardQueryOptions = ReadOnlyQueryOptions<TicketBoardState> & {
  dataset?: BoardDataset;
};

export function useTicketBoard(
  scope: BoardScope,
  initialData: BoardBootstrap,
  options?: TicketBoardQueryOptions
): UseQueryResult<TicketBoardState, Error> {
  const dataset = options?.dataset ?? 'board';
  return useQuery<TicketBoardState, Error, TicketBoardState>({
    queryKey: ticketQueryKeys.board(scope, dataset),
    queryFn: async () => normalizeBoardBootstrap(await defaultBoardFetcher(scope, dataset)),
    initialData: () => normalizeBoardBootstrap(initialData),
    staleTime: options?.staleTime ?? 30_000,
    refetchOnMount: options?.refetchOnMount ?? false,
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled ?? true
  });
}

export function useTicketStatuses(
  organizationId: number | undefined,
  initialData: BoardStatus[],
  options?: ReadOnlyQueryOptions<BoardStatus[]>
): UseQueryResult<BoardStatus[], Error> {
  return useQuery<BoardStatus[], Error, BoardStatus[]>({
    queryKey: ticketQueryKeys.statuses(organizationId),
    queryFn: () => defaultStatusesFetcher(organizationId),
    initialData,
    staleTime: options?.staleTime ?? 60_000,
    refetchOnMount: options?.refetchOnMount ?? false,
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled ?? true
  });
}

export function useProjects(
  initialData: SidebarProject[],
  options?: ReadOnlyQueryOptions<SidebarProject[]>
): UseQueryResult<SidebarProject[], Error> {
  return useQuery<SidebarProject[], Error, SidebarProject[]>({
    queryKey: ticketQueryKeys.projects(),
    queryFn: defaultProjectsFetcher,
    initialData,
    staleTime: options?.staleTime ?? 60_000,
    refetchOnMount: options?.refetchOnMount ?? false,
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled ?? true
  });
}
