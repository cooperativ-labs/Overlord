import { type SupabaseClient } from '@supabase/supabase-js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID_REGEX = /^[0-9a-f]{8}$/i;

/** Sessions without a heartbeat for this duration are considered stale. */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Resolves a ticket ID to a full UUID, scoped to the organization.
 * - Full UUIDs are returned as-is (no DB query).
 * - 8-character short IDs are resolved via DB lookup.
 * - Returns null for invalid format, ambiguous matches, or not-found short IDs.
 */
async function resolveTicketId(
  supabase: SupabaseClient,
  shortOrFull: string,
  organizationId: number
): Promise<string | null> {
  if (UUID_REGEX.test(shortOrFull)) return shortOrFull;
  if (!SHORT_ID_REGEX.test(shortOrFull)) return null;

  const { data } = await supabase
    .from('tickets')
    .select('id')
    .eq('organization_id', organizationId)
    .ilike('id', `%${shortOrFull}`)
    .limit(2);

  if (!data || data.length !== 1) return null;
  return data[0].id;
}

// ---------------------------------------------------------------------------
// Session helper
// ---------------------------------------------------------------------------

export async function resolveSession(
  supabase: SupabaseClient,
  sessionKey: string,
  ticketId: string,
  organizationId: number
) {
  const resolvedId = await resolveTicketId(supabase, ticketId, organizationId);
  if (!resolvedId) {
    return { error: 'Ticket not found or access denied.', session: null, resolvedTicketId: null };
  }

  const { data: ticket, error: ticketErr } = await supabase
    .from('tickets')
    .select('id')
    .eq('id', resolvedId)
    .eq('organization_id', organizationId)
    .single();

  if (ticketErr || !ticket) {
    return { error: 'Ticket not found or access denied.', session: null, resolvedTicketId: null };
  }

  const { data: session, error: sessionErr } = await supabase
    .from('agent_sessions')
    .select('*')
    .eq('session_key', sessionKey)
    .eq('ticket_id', resolvedId)
    .single();

  if (sessionErr || !session) {
    return { error: 'Session not found for ticket.', session: null, resolvedTicketId: null };
  }

  // Check for session timeout — mark stale sessions as disconnected
  if (session.session_state === 'attached' && session.heartbeat_at) {
    const lastHeartbeat = new Date(session.heartbeat_at).getTime();
    if (Date.now() - lastHeartbeat > SESSION_TIMEOUT_MS) {
      await supabase
        .from('agent_sessions')
        .update({ session_state: 'disconnected', detached_at: new Date().toISOString() })
        .eq('id', session.id);
      return {
        error:
          'Session timed out due to inactivity. Please call attach again to start a new session.',
        session: null,
        resolvedTicketId: null
      };
    }
  }

  // Update heartbeat
  await supabase
    .from('agent_sessions')
    .update({ heartbeat_at: new Date().toISOString() })
    .eq('id', session.id);

  return { error: null, session, resolvedTicketId: resolvedId };
}
