'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { projectGraphQueryKeys } from '@/lib/client-data/project-graph/query-keys';
import { createClient } from '@/supabase/utils/client';

import type { GraphApiResponse } from './types';

/**
 * Subscribes to file_changes inserts for the currently visible tickets and
 * invalidates the project-graph query so a fresh, fully-enriched payload is
 * fetched. We rely on react-query's existing caching to keep the canvas
 * responsive; the realtime layer just signals "something new arrived".
 */
export function useGraphRealtime(input: {
  projectId: string;
  ticketIds: string[];
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const { projectId, ticketIds, enabled } = input;
  const ticketIdsKey = [...ticketIds].sort().join(',');

  useEffect(() => {
    if (enabled === false) return;
    if (ticketIds.length === 0) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`project-graph:${projectId}:${ticketIdsKey}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'file_changes',
          filter: `ticket_id=in.(${ticketIds.join(',')})`
        },
        () => {
          // Mark cache stale; the active query will refetch on next interaction.
          // We refetch immediately so the canvas updates without user input.
          void queryClient.invalidateQueries({
            queryKey: projectGraphQueryKeys.graph(projectId, ticketIds),
            refetchType: 'active'
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'file_changes',
          filter: `ticket_id=in.(${ticketIds.join(',')})`
        },
        payload => {
          // Patch fields in place when possible to avoid full refetch.
          const updated = payload.new as { id: string; [k: string]: unknown } | null;
          if (!updated) return;
          queryClient.setQueryData<GraphApiResponse | undefined>(
            projectGraphQueryKeys.graph(projectId, ticketIds),
            prev => {
              if (!prev) return prev;
              const next = prev.fileChanges.map(fc =>
                fc.id === updated.id ? { ...fc, ...(updated as Partial<typeof fc>) } : fc
              );
              return { ...prev, fileChanges: next };
            }
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, ticketIdsKey, ticketIds, enabled, queryClient]);
}
