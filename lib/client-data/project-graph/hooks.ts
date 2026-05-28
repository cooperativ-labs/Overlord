'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { GraphFilters } from '@/components/features/projects/graph/types';
import { buildGraphViewModel } from '@/components/features/projects/graph/view-model';

import { fetchProjectGraph, fetchProjectHotspots } from './fetchers';
import { projectGraphQueryKeys } from './query-keys';

export function useProjectGraphQuery(input: {
  projectId: string;
  ticketIds: string[];
  includeCompleted?: boolean;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: projectGraphQueryKeys.graph(input.projectId, input.ticketIds),
    queryFn: () =>
      fetchProjectGraph(input.projectId, input.ticketIds, {
        includeCompleted: input.includeCompleted
      }),
    enabled: input.enabled !== false && input.ticketIds.length > 0,
    staleTime: 30_000,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: false
  });
}

export function useGraphViewModel(input: {
  projectId: string;
  ticketIds: string[];
  includeCompleted?: boolean;
  enabled?: boolean;
  filters?: GraphFilters;
}) {
  const query = useProjectGraphQuery(input);

  const viewModel = useMemo(() => {
    if (!query.data) return null;
    return buildGraphViewModel(query.data, input.filters);
  }, [query.data, input.filters]);

  return {
    ...query,
    viewModel
  };
}

export function useProjectHotspotsQuery(input: {
  projectId: string;
  windowDays?: number;
  directory?: string | null;
  enabled?: boolean;
}) {
  const windowDays = input.windowDays ?? 90;
  const directory = input.directory ?? null;
  return useQuery({
    queryKey: projectGraphQueryKeys.hotspots(input.projectId, windowDays, directory),
    queryFn: () =>
      fetchProjectHotspots(input.projectId, {
        windowDays,
        directory
      }),
    enabled: input.enabled !== false,
    staleTime: 60_000,
    refetchOnWindowFocus: false
  });
}
