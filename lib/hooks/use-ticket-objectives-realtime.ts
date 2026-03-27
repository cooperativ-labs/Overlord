'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type ObjectiveRow = Pick<
  Database['public']['Tables']['objectives']['Row'],
  | 'id'
  | 'objective'
  | 'is_executed'
  | 'created_at'
  | 'title'
  | 'state'
  | 'agent_identifier'
  | 'model_identifier'
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

type UseTicketObjectivesRealtimeOptions = {
  ticketId: string;
  initialObjectives: ObjectiveRow[];
};

export function useTicketObjectivesRealtime({
  ticketId,
  initialObjectives
}: UseTicketObjectivesRealtimeOptions) {
  const [objectives, setObjectives] = useState<ObjectiveRow[]>(initialObjectives);

  useEffect(() => {
    setObjectives(initialObjectives);
  }, [initialObjectives, ticketId]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const syncObjectives = async () => {
      const { data } = await supabase
        .from('objectives')
        .select('id,objective,is_executed,created_at,title,state,agent_identifier,model_identifier')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });

      if (cancelled || !data) return;
      setObjectives(sortByCreatedAtDesc(data));
    };

    void syncObjectives();

    const channel = supabase
      .channel(`ticket-objectives-realtime:${ticketId}`)
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

          setObjectives(current => {
            if (payload.eventType === 'DELETE') {
              return current.filter(objective => objective.id !== previous?.id);
            }

            return upsertObjective(current, incoming);
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [ticketId]);

  return objectives;
}
