'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

const FEED_REFRESH_DEBOUNCE_MS = 1500;

function shouldRefreshFeed(event: TicketEvent): boolean {
  // The feed is regenerated from ticket events when a ticket is delivered or
  // moved into review, so those are the events that can change what the feed
  // query returns.
  return (
    event.event_type === 'deliver' ||
    (event.event_type === 'status_change' && event.phase === 'review')
  );
}

export function useFeedRealtime() {
  const router = useRouter();
  const refreshTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const scheduleRefresh = () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      refreshTimeoutRef.current = window.setTimeout(() => {
        refreshTimeoutRef.current = null;
        router.refresh();
      }, FEED_REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel('feed-realtime')
      .on<TicketEvent>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ticket_events'
        },
        payload => {
          if (!shouldRefreshFeed(payload.new)) return;
          scheduleRefresh();
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleRefresh();
        }
      });

    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [router]);
}
