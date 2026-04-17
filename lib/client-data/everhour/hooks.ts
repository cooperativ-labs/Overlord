'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type EverhourTimer,
  getCurrentEverhourTimer,
  startEverhourTimerForTicket,
  stopEverhourTimer
} from '@/lib/actions/everhour';
import { updateTicketInBoards } from '@/lib/client-data/tickets/cache';

const ACTIVE_INTERVAL_MS = 5_000;
const HIDDEN_INTERVAL_MS = 30_000;
const INACTIVE_INTERVAL_MS = 15_000;

export const everhourQueryKeys = {
  all: ['everhour'] as const,
  activeTimer: () => ['everhour', 'active-timer'] as const
} as const;

function inactiveTimer(): EverhourTimer {
  return { status: 'inactive' };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Everhour request failed.';
}

export function useEverhourTimerQuery() {
  const queryClient = useQueryClient();
  const query = useQuery<EverhourTimer, Error>({
    queryKey: everhourQueryKeys.activeTimer(),
    queryFn: getCurrentEverhourTimer,
    initialData: inactiveTimer,
    staleTime: 5_000,
    refetchInterval: queryState => {
      if (typeof document !== 'undefined' && document.hidden) return HIDDEN_INTERVAL_MS;
      const timer = queryState.state.data as EverhourTimer | undefined;
      return timer?.status === 'active' ? ACTIVE_INTERVAL_MS : INACTIVE_INTERVAL_MS;
    },
    refetchOnWindowFocus: true
  });

  const startMutation = useMutation({
    mutationFn: (ticketId: string) => startEverhourTimerForTicket(ticketId),
    onSuccess: (timer, ticketId) => {
      queryClient.setQueryData(everhourQueryKeys.activeTimer(), timer);
      if (timer.task?.id) {
        updateTicketInBoards(queryClient, ticketId, { everhour_task_id: timer.task.id });
      }
    }
  });

  const stopMutation = useMutation({
    mutationFn: stopEverhourTimer,
    onMutate: () => {
      queryClient.setQueryData(everhourQueryKeys.activeTimer(), inactiveTimer());
    },
    onSuccess: () => {
      queryClient.setQueryData(everhourQueryKeys.activeTimer(), inactiveTimer());
      void queryClient.invalidateQueries({ queryKey: everhourQueryKeys.activeTimer() });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: everhourQueryKeys.activeTimer() });
    }
  });

  const mutationError = startMutation.error ?? stopMutation.error;

  return {
    errorMessage: mutationError ? getErrorMessage(mutationError) : (query.error?.message ?? null),
    isLoading: query.isFetching || startMutation.isPending || stopMutation.isPending,
    timer: query.data ?? inactiveTimer(),
    updatedAt: query.dataUpdatedAt || null,
    refresh: async () => {
      await query.refetch();
    },
    startForTicket: async (ticketId: string) => startMutation.mutateAsync(ticketId),
    stop: async () => {
      await stopMutation.mutateAsync();
    }
  };
}
