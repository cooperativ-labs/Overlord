import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { getSupabase } from '@/lib/supabase';

/**
 * Subscribes to realtime changes for a specific ticket.
 * Calls onUpdate whenever ticket data, events, objectives, or sessions change.
 */
export function useTicketRealtime(
  ticketId: string,
  onUpdate: (options?: { suppressTransientNetworkAlert?: boolean }) => void
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const supabase = getSupabase();

    const channel = supabase
      .channel(`ticket-realtime:${ticketId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` },
        () => onUpdateRef.current({ suppressTransientNetworkAlert: true })
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ticket_events',
          filter: `ticket_id=eq.${ticketId}`
        },
        () => onUpdateRef.current({ suppressTransientNetworkAlert: true })
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'objectives', filter: `ticket_id=eq.${ticketId}` },
        () => onUpdateRef.current({ suppressTransientNetworkAlert: true })
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          onUpdateRef.current({ suppressTransientNetworkAlert: true });
        }
      });

    // Poll every 4 seconds as fallback (matches desktop)
    const pollId = setInterval(() => {
      onUpdateRef.current({ suppressTransientNetworkAlert: true });
    }, 4_000);

    // Refresh after foregrounding. iOS can report active before fetch is usable.
    let foregroundRefreshId: ReturnType<typeof setTimeout> | null = null;
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        if (foregroundRefreshId) clearTimeout(foregroundRefreshId);
        foregroundRefreshId = setTimeout(() => {
          onUpdateRef.current({ suppressTransientNetworkAlert: true });
        }, 1_500);
      }
    });

    return () => {
      if (foregroundRefreshId) clearTimeout(foregroundRefreshId);
      clearInterval(pollId);
      appStateSubscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [ticketId]);
}
