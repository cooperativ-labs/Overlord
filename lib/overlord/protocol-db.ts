import { createServiceRoleClient } from '@/supabase/utils/service-role';

type EventInsert = {
  eventType:
    | 'system'
    | 'question'
    | 'answer'
    | 'update'
    | 'user_follow_up'
    | 'ticket_reopened'
    | 'context_write'
    | 'context_read'
    | 'artifact'
    | 'deliver'
    | 'status_change'
    | 'alert';
  isBlocking?: boolean;
  payload?: Record<string, unknown>;
  phase?: string | null;
  sessionId?: string | null;
  summary?: string | null;
  ticketId: string;
};

/**
 * Resolves an agent session by sessionKey + ticketId.
 * When organizationId is provided, it first verifies the ticket belongs to that org
 * to prevent cross-org session access.
 */
export async function resolveSession(
  sessionKey: string,
  ticketId: string,
  organizationId?: number
) {
  const supabase = createServiceRoleClient();

  // If org-scoped, verify the ticket belongs to this org before touching the session
  if (organizationId !== undefined) {
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('id')
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .single();

    if (ticketError || !ticket) {
      return { error: 'Ticket not found or access denied.', session: null };
    }
  }

  const { data: session, error } = await supabase
    .from('agent_sessions')
    .select('*')
    .eq('session_key', sessionKey)
    .eq('ticket_id', ticketId)
    .single();

  if (error || !session) {
    return {
      error: 'Session not found for ticket.',
      session: null
    };
  }

  await supabase
    .from('agent_sessions')
    .update({ heartbeat_at: new Date().toISOString() })
    .eq('id', session.id);

  return {
    error: null,
    session
  };
}

export async function insertTicketEvent(input: EventInsert) {
  const supabase = createServiceRoleClient();
  return supabase.from('ticket_events').insert({
    event_type: input.eventType,
    is_blocking: input.isBlocking ?? false,
    payload: input.payload ?? {},
    phase: input.phase ?? null,
    session_id: input.sessionId ?? null,
    summary: input.summary ?? null,
    ticket_id: input.ticketId
  });
}
