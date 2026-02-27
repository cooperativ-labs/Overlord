'use client';

import { useEffect, useRef, useState } from 'react';

import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type Artifact = Database['public']['Tables']['artifacts']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];
type SharedState = Database['public']['Tables']['shared_state']['Row'];
type JsonValue = Database['public']['Tables']['ticket_events']['Row']['payload'];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getEventPayload(payload: JsonValue): Record<string, unknown> {
  return isRecord(payload) ? payload : {};
}

function isAgentNotificationEvent(event: TicketEvent): boolean {
  if (event.event_type !== 'alert' && event.event_type !== 'question') return false;
  const payload = getEventPayload(event.payload);
  return payload.entry_type === 'agent_notification';
}

function shouldShowDesktopNotification(event: TicketEvent): boolean {
  if (event.event_type === 'deliver' || event.event_type === 'question') return true;
  return isAgentNotificationEvent(event);
}

function getNotificationTitle(ticketId: string, event: TicketEvent): string {
  if (event.event_type === 'question') {
    return `Agent Question (${ticketId.slice(-8)})`;
  }
  if (event.event_type === 'deliver') {
    return `Agent Delivered (${ticketId.slice(-8)})`;
  }
  return `Agent Notification (${ticketId.slice(-8)})`;
}

function getNotificationBody(event: TicketEvent): string {
  const payload = getEventPayload(event.payload);
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  const summary = event.summary?.trim() ?? '';
  if (summary) return summary;
  if (message) return message;
  if (event.event_type === 'deliver') return 'The agent delivered this ticket for review.';
  return 'New agent event received.';
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
  const notifiedEventIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    notifiedEventIdsRef.current = new Set();
  }, [ticketId]);

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
          const incomingEvent = payload.new;
          setEvents(previous => mergeNewestById([incomingEvent], previous, row => row.created_at));

          if (
            shouldShowDesktopNotification(incomingEvent) &&
            !notifiedEventIdsRef.current.has(incomingEvent.id)
          ) {
            notifiedEventIdsRef.current.add(incomingEvent.id);
            if (notifiedEventIdsRef.current.size > 500) {
              notifiedEventIdsRef.current.clear();
            }
            const title = getNotificationTitle(ticketId, incomingEvent);
            const body = getNotificationBody(incomingEvent);
            void window.electronAPI?.app?.notify(title, body);
          }
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
          setArtifacts(previous => mergeNewestById([payload.new], previous, row => row.created_at));
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
