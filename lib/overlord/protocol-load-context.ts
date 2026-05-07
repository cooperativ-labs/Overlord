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
  // Draft objectives are intentionally hidden from agent context on modern
  // schemas, but we keep a draft fallback for databases that have not picked
  // up the submitted-state migration yet.
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
    ).data ??
    (
      await supabase
        .from('objectives')
        .select('objective')
        .eq('ticket_id', ticketId)
        .eq('state', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data;

  const [
    { data: history },
    { data: artifacts },
    { data: attachments },
    { data: objectives },
    { data: sharedState }
  ] = await Promise.all([
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
      .from('objective_attachments')
      .select('id, label, content_type, file_size, objective_id, storage_path, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('objectives')
      .select('id, objective, state, created_at')
      .eq('ticket_id', ticketId)
      .neq('state', 'draft')
      .order('created_at', { ascending: true })
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
      attachments: attachments ?? [],
      objectives: objectives ?? [],
      sharedState: sharedState ?? []
    }
  } as const;
}
