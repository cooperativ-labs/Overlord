import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { getSupabase } from '@/lib/supabase';

/**
 * Subscribes to realtime changes for a specific ticket.
 * Calls onUpdate whenever ticket data, events, objectives, or sessions change.
 */
export function useTicketRealtime(ticketId: string, onUpdate: () => void) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const supabase = getSupabase();

    const channel = supabase
      .channel(`ticket-realtime:${ticketId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` },
        () => onUpdateRef.current()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ticket_events', filter: `ticket_id=eq.${ticketId}` },
        () => onUpdateRef.current()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'objectives', filter: `ticket_id=eq.${ticketId}` },
        () => onUpdateRef.current()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_sessions', filter: `ticket_id=eq.${ticketId}` },
        () => onUpdateRef.current()
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          onUpdateRef.current();
        }
      });

    // Poll every 4 seconds as fallback (matches desktop)
    const pollId = setInterval(() => {
      onUpdateRef.current();
    }, 4_000);

    // Refresh when app returns to foreground
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        onUpdateRef.current();
      }
    });

    return () => {
      clearInterval(pollId);
      appStateSubscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [ticketId]);
}
