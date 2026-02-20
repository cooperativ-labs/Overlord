'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type Artifact = Database['public']['Tables']['artifacts']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];
type SharedState = Database['public']['Tables']['shared_state']['Row'];

const MAX_ROWS = 50;

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function mergeNewestById<T extends { id: string }>(
  incoming: T[],
  existing: T[],
  getTimestamp: (row: T) => string | null | undefined,
  maxRows = MAX_ROWS
): T[] {
  const byId = new Map<string, T>();

  for (const row of [...incoming, ...existing]) {
    const current = byId.get(row.id);
    if (!current) {
      byId.set(row.id, row);
      continue;
    }

    if (parseTimestamp(getTimestamp(row)) > parseTimestamp(getTimestamp(current))) {
      byId.set(row.id, row);
    }
  }

  return [...byId.values()]
    .sort((left, right) => parseTimestamp(getTimestamp(right)) - parseTimestamp(getTimestamp(left)))
    .slice(0, maxRows);
}

function pickNewestSession(previous: AgentSession | null, incoming: AgentSession | null) {
  if (!incoming) return previous;
  if (!previous || previous.id === incoming.id) return incoming;
  return incoming.attached_at > previous.attached_at ? incoming : previous;
}

type UseTicketRealtimeOptions = {
  ticketId: string;
  initialEvents: TicketEvent[];
  initialArtifacts: Artifact[];
  initialSession: AgentSession | null;
  initialSharedState: SharedState[];
};

export function useTicketRealtime({
  ticketId,
  initialEvents,
  initialArtifacts,
  initialSession,
  initialSharedState
}: UseTicketRealtimeOptions) {
  const [events, setEvents] = useState<TicketEvent[]>(initialEvents);
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [session, setSession] = useState<AgentSession | null>(initialSession);
  const [sharedState, setSharedState] = useState<SharedState[]>(initialSharedState);

  useEffect(() => {
    setEvents(initialEvents);
    setArtifacts(initialArtifacts);
    setSession(initialSession);
    setSharedState(initialSharedState);
  }, [initialArtifacts, initialEvents, initialSession, initialSharedState, ticketId]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const syncTicketData = async () => {
      const [eventsResult, artifactsResult, sessionResult, stateResult] = await Promise.all([
        supabase
          .from('ticket_events')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('artifacts')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('agent_sessions')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('attached_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('shared_state')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: false })
          .limit(20)
      ]);

      if (cancelled) return;

      if (eventsResult.data) {
        setEvents(previous =>
          mergeNewestById(eventsResult.data ?? [], previous, row => row.created_at)
        );
      }
      if (artifactsResult.data) {
        setArtifacts(previous =>
          mergeNewestById(artifactsResult.data ?? [], previous, row => row.created_at)
        );
      }
      if (stateResult.data) {
        setSharedState(previous =>
          mergeNewestById(stateResult.data ?? [], previous, row => row.created_at)
        );
      }
      if (sessionResult.data) {
        setSession(previous => pickNewestSession(previous, sessionResult.data));
      }
    };

    const channel = supabase
      .channel(`ticket-realtime:${ticketId}`)
      .on<TicketEvent>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ticket_events',
          filter: `ticket_id=eq.${ticketId}`
        },
        payload => {
          setEvents(previous => mergeNewestById([payload.new], previous, row => row.created_at));
        }
      )
      .on<Artifact>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'artifacts',
          filter: `ticket_id=eq.${ticketId}`
        },
        payload => {
          setArtifacts(previous =>
            mergeNewestById([payload.new], previous, row => row.created_at)
          );
        }
      )
      .on<AgentSession>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_sessions',
          filter: `ticket_id=eq.${ticketId}`
        },
        payload => {
          setSession(previous => pickNewestSession(previous, payload.new));
        }
      )
      .on<AgentSession>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_sessions',
          filter: `ticket_id=eq.${ticketId}`
        },
        payload => {
          setSession(previous => pickNewestSession(previous, payload.new));
        }
      )
      .on<SharedState>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'shared_state',
          filter: `ticket_id=eq.${ticketId}`
        },
        payload => {
          setSharedState(previous =>
            mergeNewestById([payload.new], previous, row => row.created_at)
          );
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          void syncTicketData();
        }
      });

    const pollId = window.setInterval(() => {
      void syncTicketData();
    }, 4_000);

    void syncTicketData();

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [ticketId]);

  return { events, artifacts, session, sharedState };
}
