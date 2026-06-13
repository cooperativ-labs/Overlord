import { type SupabaseClient } from '@supabase/supabase-js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_ID_REGEX = /^\d+:\d+$/;

/** Sessions without a heartbeat for this duration are considered stale. */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const STALE_SESSION_REATTACH_MESSAGE =
  'Session is no longer attached. Call attach again to start a new session.';

function isProtocolUsableSessionState(
  sessionState: string,
  options?: { allowCompletedReactivation?: boolean }
): boolean {
  if (sessionState === 'attached') return true;
  if (options?.allowCompletedReactivation && sessionState === 'completed') return true;
  return false;
}

async function canReattachExecutingObjective(
  supabase: SupabaseClient,
  objectiveId: string
): Promise<boolean> {
  const { data: latestSession, error } = await supabase
    .from('agent_sessions')
    .select('session_state')
    .eq('objective_id', objectiveId)
    .order('attached_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!latestSession) return true;
  return latestSession.session_state !== 'completed';
}

/**
 * Resolves a ticket identifier to a full UUID, scoped to the organization.
 * - Full UUIDs are returned as-is (no DB query).
 * - Human-readable ticket_id strings (e.g. "1:899") are resolved via exact ticket_id lookup.
 * - Returns null for invalid format or not-found identifiers.
 */
async function resolveTicketId(
  supabase: SupabaseClient,
  shortOrFull: string,
  organizationId: number
): Promise<string | null> {
  if (UUID_REGEX.test(shortOrFull)) return shortOrFull;

  if (TICKET_ID_REGEX.test(shortOrFull)) {
    const { data } = await supabase
      .from('tickets')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('ticket_id', shortOrFull)
      .limit(2);

    if (!data || data.length !== 1) return null;
    return data[0].id;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Session helper
// ---------------------------------------------------------------------------

type ResolveSessionOptions = {
  allowCompletedReactivation?: boolean;
};

export async function resolveSession(
  supabase: SupabaseClient,
  sessionKey: string,
  ticketId: string,
  organizationId: number,
  externalSessionId?: string | null,
  options?: ResolveSessionOptions
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
    .select('*, objectives!inner(ticket_id, ticket:tickets!inner(organization_id))')
    .eq('session_key', sessionKey)
    .eq('objectives.ticket_id', resolvedId)
    .eq('objectives.ticket.organization_id', organizationId)
    .single();

  if (sessionErr || !session) {
    return { error: 'Session not found for ticket.', session: null, resolvedTicketId: null };
  }

  if (
    !isProtocolUsableSessionState(session.session_state, {
      allowCompletedReactivation: options?.allowCompletedReactivation
    })
  ) {
    return {
      error: STALE_SESSION_REATTACH_MESSAGE,
      session: null,
      resolvedTicketId: null
    };
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

  const sessionUpdate: Record<string, string> = {
    heartbeat_at: new Date().toISOString()
  };
  if (typeof externalSessionId === 'string' && externalSessionId.trim().length > 0) {
    sessionUpdate.external_session_id = externalSessionId.trim();
  }

  // Update heartbeat and opportunistically persist the native MCP session id.
  await supabase.from('agent_sessions').update(sessionUpdate).eq('id', session.id);

  return { error: null, session, resolvedTicketId: resolvedId };
}

export { canReattachExecutingObjective };
