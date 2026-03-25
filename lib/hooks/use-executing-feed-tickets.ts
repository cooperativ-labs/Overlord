'use client';

import { useEffect, useState } from 'react';

import type { ExecutingFeedTicket } from '@/lib/actions/feed';
import { createClient } from '@/supabase/utils/client';

async function loadExecutingFeedTickets(): Promise<ExecutingFeedTicket[]> {
  const supabase = createClient();

  const { data: tickets, error: ticketsError } = await supabase
    .from('tickets')
    .select(
      `
      id,
      project_id,
      title,
      ticket_sequence,
      projects!inner(name, color)
    `
    )
    .eq('status', 'execute')
    .order('updated_at', { ascending: false })
    .limit(24);

  if (ticketsError) {
    console.error('[useExecutingFeedTickets] tickets error:', ticketsError);
    return [];
  }

  const rows = (tickets ?? []) as Array<
    Record<string, unknown> & {
      id: string;
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

export function useExecutingFeedTickets(initialTickets: ExecutingFeedTicket[]) {
  const [tickets, setTickets] = useState(initialTickets);

  useEffect(() => {
    setTickets(initialTickets);
  }, [initialTickets]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const refresh = async () => {
      const nextTickets = await loadExecutingFeedTickets();
      if (!cancelled) {
        setTickets(nextTickets);
      }
    };

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
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          void refresh();
        }
      });

    const pollId = window.setInterval(() => {
      void refresh();
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, []);

  return tickets;
}
