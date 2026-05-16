'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { ticketQueryKeys } from '@/lib/client-data/tickets/query-keys';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type ObjectiveRow = Pick<
  Database['public']['Tables']['objectives']['Row'],
  | 'id'
  | 'objective'
  | 'created_at'
  | 'title'
  | 'state'
  | 'agent_identifier'
  | 'model_identifier'
  | 'assigned_agent'
  | 'position'
  | 'auto_advance'
  | 'auto_advanced_at'
  | 'approval_reason'
>;

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortByCreatedAtDesc(objectives: ObjectiveRow[]): ObjectiveRow[] {
  return [...objectives].sort(
    (left, right) => parseTimestamp(right.created_at) - parseTimestamp(left.created_at)
  );
}

function upsertObjective(objectives: ObjectiveRow[], incoming: ObjectiveRow): ObjectiveRow[] {
  const next = objectives.filter(objective => objective.id !== incoming.id);
  next.push(incoming);
  return sortByCreatedAtDesc(next);
}

function removeObjective(
  objectives: ObjectiveRow[],
  objectiveId: string | undefined
): ObjectiveRow[] {
  if (!objectiveId) return objectives;
  return objectives.filter(objective => objective.id !== objectiveId);
}

function buildTicketObjectivesChannelName(ticketId: string): string {
  const channelSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `ticket-objectives-realtime:${ticketId}:${channelSuffix}`;
}

type UseTicketObjectivesRealtimeOptions = {
  ticketId: string;
  initialObjectives: ObjectiveRow[];
};

export function useTicketObjectivesRealtime({
  ticketId,
  initialObjectives
}: UseTicketObjectivesRealtimeOptions) {
  const queryClient = useQueryClient();
  const objectivesQuery = useQuery({
    queryKey: ticketQueryKeys.ticketObjectives(ticketId),
    queryFn: async () => initialObjectives,
    initialData: initialObjectives,
    staleTime: 30_000,
    refetchOnMount: false
  });

  useEffect(() => {
    queryClient.setQueryData(ticketQueryKeys.ticketObjectives(ticketId), initialObjectives);
  }, [initialObjectives, queryClient, ticketId]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const syncObjectives = async () => {
      const { data } = await supabase
        .from('objectives')
        .select(
          'id,objective,created_at,title,state,agent_identifier,model_identifier,assigned_agent,position,auto_advance,auto_advanced_at,approval_reason'
        )
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });

      if (cancelled || !data) return;
      queryClient.setQueryData<ObjectiveRow[]>(
        ticketQueryKeys.ticketObjectives(ticketId),
        sortByCreatedAtDesc(data)
      );
    };

    void syncObjectives();

    const channel = supabase
      .channel(buildTicketObjectivesChannelName(ticketId))
      .on<ObjectiveRow>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'objectives',
          filter: `ticket_id=eq.${ticketId}`
        },
        payload => {
          const incoming = payload.new as ObjectiveRow;
          const previous = payload.old as ObjectiveRow | undefined;

          queryClient.setQueryData<ObjectiveRow[]>(
            ticketQueryKeys.ticketObjectives(ticketId),
            current => {
              const existing = current ?? [];
              if (payload.eventType === 'DELETE') {
                return removeObjective(existing, previous?.id);
              }

              return upsertObjective(existing, incoming);
            }
          );
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          void syncObjectives();
        }
      });

    const pollId = window.setInterval(() => {
      void syncObjectives();
    }, 4_000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [queryClient, ticketId]);

  return objectivesQuery.data ?? [];
}
