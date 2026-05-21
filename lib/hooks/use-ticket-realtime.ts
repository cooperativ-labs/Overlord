'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { ticketQueryKeys } from '@/lib/client-data/tickets/query-keys';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type Artifact = Database['public']['Tables']['artifacts']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];
type FileChange = Database['public']['Tables']['file_changes']['Row'];
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

function getNotificationTitle(ticketReference: string, event: TicketEvent): string {
  if (event.event_type === 'question') {
    return `Agent Question (${ticketReference})`;
  }
  if (event.event_type === 'deliver') {
    return `Agent Delivered (${ticketReference})`;
  }
  return `Agent Notification (${ticketReference})`;
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
  ticketReference?: string;
  initialEvents: TicketEvent[];
  initialArtifacts: Artifact[];
  initialFileChanges: FileChange[];
  initialSession: AgentSession | null;
  initialSharedState: SharedState[];
};

export function useTicketRealtime({
  ticketId,
  ticketReference,
  initialEvents,
  initialArtifacts,
  initialFileChanges,
  initialSession,
  initialSharedState
}: UseTicketRealtimeOptions) {
  const queryClient = useQueryClient();
  const notifiedEventIdsRef = useRef<Set<string>>(new Set());
  const resolvedTicketReference = ticketReference || getTicketIdentifier(ticketId);
  const eventsQuery = useQuery({
    queryKey: ticketQueryKeys.ticketEvents(ticketId),
    queryFn: async () => initialEvents,
    initialData: initialEvents,
    staleTime: 30_000,
    refetchOnMount: false
  });
  const artifactsQuery = useQuery({
    queryKey: ticketQueryKeys.ticketArtifacts(ticketId),
    queryFn: async () => initialArtifacts,
    initialData: initialArtifacts,
    staleTime: 30_000,
    refetchOnMount: false
  });
  const fileChangesQuery = useQuery({
    queryKey: ticketQueryKeys.ticketFileChanges(ticketId),
    queryFn: async () => initialFileChanges,
    initialData: initialFileChanges,
    staleTime: 30_000,
    refetchOnMount: false
  });
  const sessionQuery = useQuery({
    queryKey: ticketQueryKeys.ticketSession(ticketId),
    queryFn: async () => initialSession,
    initialData: initialSession,
    staleTime: 30_000,
    refetchOnMount: false
  });
  const sharedStateQuery = useQuery({
    queryKey: ticketQueryKeys.ticketSharedState(ticketId),
    queryFn: async () => initialSharedState,
    initialData: initialSharedState,
    staleTime: 30_000,
    refetchOnMount: false
  });

  useEffect(() => {
    notifiedEventIdsRef.current = new Set();
  }, [ticketId]);

  useEffect(() => {
    queryClient.setQueryData(ticketQueryKeys.ticketEvents(ticketId), initialEvents);
    queryClient.setQueryData(ticketQueryKeys.ticketArtifacts(ticketId), initialArtifacts);
    queryClient.setQueryData(ticketQueryKeys.ticketFileChanges(ticketId), initialFileChanges);
    queryClient.setQueryData(ticketQueryKeys.ticketSession(ticketId), initialSession);
    queryClient.setQueryData(ticketQueryKeys.ticketSharedState(ticketId), initialSharedState);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial* omitted on purpose; see comment above
  }, [queryClient, resolvedTicketReference, ticketId]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const syncTicketData = async () => {
      const [eventsResult, artifactsResult, fileChangesResult, sessionResult, stateResult] =
        await Promise.all([
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
            .from('file_changes')
            .select('*')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: false })
            .limit(20),
          supabase
            .from('agent_sessions')
            .select('*, objective:objectives!inner(ticket_id)')
            .eq('objective.ticket_id', ticketId)
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
        queryClient.setQueryData<TicketEvent[]>(ticketQueryKeys.ticketEvents(ticketId), previous =>
          mergeNewestById(eventsResult.data ?? [], previous ?? [], row => row.created_at)
        );
      }
      if (artifactsResult.data) {
        queryClient.setQueryData<Artifact[]>(ticketQueryKeys.ticketArtifacts(ticketId), previous =>
          mergeNewestById(artifactsResult.data ?? [], previous ?? [], row => row.created_at)
        );
      }
      if (fileChangesResult.data) {
        queryClient.setQueryData<FileChange[]>(
          ticketQueryKeys.ticketFileChanges(ticketId),
          previous =>
            mergeNewestById(fileChangesResult.data ?? [], previous ?? [], row => row.created_at)
        );
      }
      if (stateResult.data) {
        queryClient.setQueryData<SharedState[]>(
          ticketQueryKeys.ticketSharedState(ticketId),
          previous => mergeNewestById(stateResult.data ?? [], previous ?? [], row => row.created_at)
        );
      }
      if (sessionResult.data) {
        queryClient.setQueryData<AgentSession | null>(
          ticketQueryKeys.ticketSession(ticketId),
          previous => pickNewestSession(previous ?? null, sessionResult.data)
        );
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
          queryClient.setQueryData<TicketEvent[]>(
            ticketQueryKeys.ticketEvents(ticketId),
            previous => mergeNewestById([incomingEvent], previous ?? [], row => row.created_at)
          );

          if (
            shouldShowDesktopNotification(incomingEvent) &&
            !notifiedEventIdsRef.current.has(incomingEvent.id)
          ) {
            notifiedEventIdsRef.current.add(incomingEvent.id);
            if (notifiedEventIdsRef.current.size > 500) {
              notifiedEventIdsRef.current.clear();
            }
            const title = getNotificationTitle(resolvedTicketReference, incomingEvent);
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
          queryClient.setQueryData<Artifact[]>(
            ticketQueryKeys.ticketArtifacts(ticketId),
            previous => mergeNewestById([payload.new], previous ?? [], row => row.created_at)
          );
        }
      )
      .on<FileChange>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'file_changes',
          filter: `ticket_id=eq.${ticketId}`
        },
        payload => {
          queryClient.setQueryData<FileChange[]>(
            ticketQueryKeys.ticketFileChanges(ticketId),
            previous => mergeNewestById([payload.new], previous ?? [], row => row.created_at)
          );
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
          queryClient.setQueryData<SharedState[]>(
            ticketQueryKeys.ticketSharedState(ticketId),
            previous => mergeNewestById([payload.new], previous ?? [], row => row.created_at)
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
  }, [queryClient, resolvedTicketReference, ticketId]);

  return {
    events: eventsQuery.data ?? [],
    artifacts: artifactsQuery.data ?? [],
    fileChanges: fileChangesQuery.data ?? [],
    session: sessionQuery.data ?? null,
    sharedState: sharedStateQuery.data ?? []
  };
}
