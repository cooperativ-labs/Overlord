import { type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Session helper
// ---------------------------------------------------------------------------

export async function resolveSession(
  supabase: SupabaseClient,
  sessionKey: string,
  ticketId: string,
  organizationId: number
) {
  const { data: ticket, error: ticketErr } = await supabase
    .from('tickets')
    .select('id')
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (ticketErr || !ticket) return { error: 'Ticket not found or access denied.', session: null };

  const { data: session, error: sessionErr } = await supabase
    .from('agent_sessions')
    .select('*')
    .eq('session_key', sessionKey)
    .eq('ticket_id', ticketId)
    .single();

  if (sessionErr || !session) return { error: 'Session not found for ticket.', session: null };

  await supabase
    .from('agent_sessions')
    .update({ heartbeat_at: new Date().toISOString() })
    .eq('id', session.id);

  return { error: null, session };
}
