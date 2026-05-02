'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  applyUserTagToTicketAction,
  getTicketTagsBatchAction,
  listProjectTagDefinitionsAction,
  removeUserTagFromTicketAction
} from '@/lib/actions/tags';

import { tagQueryKeys } from './query-keys';

export function useProjectTagDefinitions(projectId: string | null | undefined) {
  return useQuery({
    queryKey: tagQueryKeys.projectTags(projectId ?? ''),
    queryFn: () => listProjectTagDefinitionsAction(projectId!),
    enabled: Boolean(projectId),
    staleTime: 30_000
  });
}

export function useTicketTagsBatch(ticketIds: string[]) {
  const sortedIds = ticketIds.slice().sort();
  return useQuery({
    queryKey: tagQueryKeys.ticketTagsBatch(sortedIds),
    queryFn: () => getTicketTagsBatchAction(sortedIds),
    enabled: sortedIds.length > 0,
    staleTime: 15_000
  });
}

export function useApplyTagMutation(ticketId: string, projectId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tagDefinitionId: string) => applyUserTagToTicketAction(ticketId, tagDefinitionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagQueryKeys.ticketTags(ticketId) });
      if (projectId) {
        void queryClient.invalidateQueries({ queryKey: tagQueryKeys.ticketTagsBatchRoot });
      }
    }
  });
}

export function useRemoveTagMutation(ticketId: string, projectId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tagDefinitionId: string) =>
      removeUserTagFromTicketAction(ticketId, tagDefinitionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagQueryKeys.ticketTags(ticketId) });
      if (projectId) {
        void queryClient.invalidateQueries({ queryKey: tagQueryKeys.ticketTagsBatchRoot });
      }
    }
  });
}
