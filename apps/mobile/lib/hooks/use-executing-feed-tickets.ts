import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getSupabase } from '@/lib/supabase';
import type { ExecutingFeedTicket } from '@/lib/types';

async function loadExecutingFeedTickets(): Promise<ExecutingFeedTicket[]> {
  const supabase = getSupabase();

  const { data: executeStatuses, error: executeStatusesError } = await supabase
    .from('ticket_statuses')
    .select('organization_id,name')
    .eq('status_type', 'execute');

  if (executeStatusesError) {
    console.error('[useExecutingFeedTickets] execute statuses error:', executeStatusesError);
    return [];
  }

  const ticketResults = await Promise.all(
    (executeStatuses ?? []).map(status =>
      supabase
        .from('tickets')
        .select(
          `
          id,
          organization_id,
          project_id,
          title,
          ticket_sequence,
          updated_at,
          projects!inner(name, color)
        `
        )
        .eq('organization_id', status.organization_id)
        .eq('status', status.name)
        .order('updated_at', { ascending: false })
        .limit(24)
    )
  );

  for (const result of ticketResults) {
    if (result.error) {
      console.error('[useExecutingFeedTickets] tickets error:', result.error);
      return [];
    }
  }

  const rows = ticketResults
    .flatMap(result => result.data ?? [])
    .sort((a, b) => {
      const left = new Date((a as { updated_at: string }).updated_at).getTime();
      const right = new Date((b as { updated_at: string }).updated_at).getTime();
      return right - left;
    })
    .slice(0, 24) as Array<
    Record<string, unknown> & {
      id: string;
      organization_id: number;
      project_id: string;
      title: string | null;
      ticket_sequence: number | null;
    }
  >;

  const ticketIds = rows.map(ticket => ticket.id);
  if (ticketIds.length === 0) return [];

  const { data: sessions, error: sessionsError } = await supabase
    .from('agent_sessions')
    .select('ticket_id,session_state,agent_identifier,attached_at')
    .in('ticket_id', ticketIds)
    .order('attached_at', { ascending: false });

  if (sessionsError) {
    console.error('[useExecutingFeedTickets] agent_sessions error:', sessionsError);
    return [];
  }

  const latestAttachedSessionByTicketId = new Map<
    string,
    { agent_identifier: string; attached_at: string | null }
  >();

  for (const session of (sessions ?? []) as Array<{
    ticket_id: string;
    session_state: string;
    agent_identifier: string;
    attached_at: string | null;
  }>) {
    if (latestAttachedSessionByTicketId.has(session.ticket_id)) continue;
    if (session.session_state !== 'attached') continue;

    latestAttachedSessionByTicketId.set(session.ticket_id, {
      agent_identifier: session.agent_identifier,
      attached_at: session.attached_at
    });
  }

  return rows
    .map(ticket => {
      const project = ticket.projects as { name: string; color: string } | null;
      const session = latestAttachedSessionByTicketId.get(ticket.id);
      if (!session?.agent_identifier) return null;

      return {
        id: ticket.id,
        project_id: ticket.project_id,
        title: ticket.title,
        ticket_sequence: ticket.ticket_sequence,
        project_name: project?.name ?? 'Unknown',
        project_color: project?.color ?? '#6b7280',
        running_agent: session.agent_identifier,
        attached_at: session.attached_at
      };
    })
    .filter((ticket): ticket is ExecutingFeedTicket => ticket !== null)
    .sort((a, b) => {
      if (!a.attached_at && !b.attached_at) return 0;
      if (!a.attached_at) return 1;
      if (!b.attached_at) return -1;
      return new Date(b.attached_at).getTime() - new Date(a.attached_at).getTime();
    });
}

export function useExecutingFeedTickets() {
  const [tickets, setTickets] = useState<ExecutingFeedTicket[]>([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const supabase = getSupabase();

    const refresh = async () => {
      const nextTickets = await loadExecutingFeedTickets();
      if (!cancelledRef.current) {
        setTickets(nextTickets);
      }
    };

    void refresh();

    // Realtime subscription for ticket and agent session changes
    const channel = supabase
      .channel('feed-executing-tickets')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        () => void refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_sessions' },
        () => void refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'objectives' },
        () => void refresh()
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          void refresh();
        }
      });

    // Polling fallback every 20 seconds
    const pollId = setInterval(() => {
      void refresh();
    }, 20_000);

    // Refresh when app comes to foreground
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        void refresh();
      }
    });

    return () => {
      cancelledRef.current = true;
      clearInterval(pollId);
      appStateSubscription.remove();
      void supabase.removeChannel(channel);
    };
  }, []);

  return tickets;
}
