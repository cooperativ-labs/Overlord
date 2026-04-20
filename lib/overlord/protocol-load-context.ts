import type { SupabaseClient } from '@supabase/supabase-js';

import { TICKET_AGENT_FIELDS } from '@/lib/overlord/protocol-attach';
import type { Database } from '@/types/database.types';

type LoadContextClient = SupabaseClient<Database>;

export type LoadContextParams = {
  ticketId: string;
  organizationId: number;
};

/**
 * Read-only fetch of ticket details, history, artifacts, and shared state.
 * Does NOT create a session or change ticket status.
 *
 * Use this when the agent wants to pull in a ticket's context without
 * establishing a tracking session.
 */
export async function runLoadContextProtocol(
  supabase: LoadContextClient,
  params: LoadContextParams
) {
  const { ticketId, organizationId } = params;

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select(TICKET_AGENT_FIELDS)
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (ticketError || !ticket) {
    return {
      error: 'Ticket not found.',
      status: ticketError?.code === 'PGRST116' ? 404 : 500
    } as const;
  }

  // Prefer the executing objective; fall back to submitted.
  // Draft objectives are intentionally hidden from agent context.
  const { data: executingObjective } = await supabase
    .from('objectives')
    .select('objective')
    .eq('ticket_id', ticketId)
    .eq('state', 'executing')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const draftObjective =
    executingObjective ??
    (
      await supabase
        .from('objectives')
        .select('objective')
        .eq('ticket_id', ticketId)
        .eq('state', 'submitted')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data;

  const [{ data: history }, { data: artifacts }, { data: sharedState }] = await Promise.all([
    supabase
      .from('ticket_events')
      .select('*')
      .eq('ticket_id', ticketId)
      .eq('event_type', 'deliver')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('artifacts')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('shared_state')
      .select('*')
      .or(`ticket_id.eq.${ticketId},ticket_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(50)
  ]);

  return {
    error: null,
    data: {
      ticket: {
        ...ticket,
        objective: draftObjective?.objective ?? undefined
      },
      history: history ?? [],
      artifacts: artifacts ?? [],
      sharedState: sharedState ?? []
    }
  } as const;
}
