'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { ExecutingFeedTicket } from '@/lib/actions/feed';
import { useExecutingFeedTickets as useExecutingFeedTicketsQuery } from '@/lib/client-data/feed/hooks';
import { feedQueryKeys } from '@/lib/client-data/feed/query-keys';
import { createClient } from '@/supabase/utils/client';

export function useExecutingFeedTickets(initialTickets: ExecutingFeedTicket[]) {
  const queryClient = useQueryClient();
  const query = useExecutingFeedTicketsQuery(initialTickets);

  useEffect(() => {
    const supabase = createClient();
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: feedQueryKeys.executingTickets() });
    };

    const channel = supabase
      .channel('feed-executing-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_sessions' }, invalidate)
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          invalidate();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query.data ?? initialTickets;
}
