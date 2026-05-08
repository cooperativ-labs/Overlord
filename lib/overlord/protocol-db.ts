import { createServiceRoleClient } from '@/supabase/utils/service-role';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_ID_REGEX = /^\d+:\d+$/;

/**
 * Resolves a ticket identifier to a full UUID.
 * - Full UUIDs are returned as-is (no DB query).
 * - Human-readable ticket_id strings (e.g. "1:899") are resolved via exact match on the ticket_id column.
 * - Returns null for invalid format, ambiguous matches, or not-found identifiers.
 */
export async function resolveTicketId(
  shortOrFull: string,
  organizationId: number
): Promise<string | null> {
  if (UUID_REGEX.test(shortOrFull)) return shortOrFull;

  const supabase = createServiceRoleClient();

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
 * When organizationId is provided, the session query uses a joined tickets filter
 * to verify org membership in a single round-trip instead of two sequential queries.
 */
export async function resolveSession(
  sessionKey: string,
  ticketId: string,
  organizationId?: number
) {
  const supabase = createServiceRoleClient();

  if (organizationId !== undefined) {
    // Single query: join session → ticket and filter by org in one round-trip.
    const { data: session, error } = await supabase
      .from('agent_sessions')
      .select('*, ticket:tickets!inner(organization_id)')
      .eq('session_key', sessionKey)
      .eq('ticket_id', ticketId)
      .eq('ticket.organization_id', organizationId)
      .single();

    if (error || !session) {
      return {
        error: 'Session not found for ticket.',
        session: null
      };
    }

    // Strip the joined ticket data before returning the session row.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ticket: _ticket, ...sessionRow } = session as typeof session & {
      ticket: unknown;
    };

    await supabase
      .from('agent_sessions')
      .update({ heartbeat_at: new Date().toISOString() })
      .eq('id', sessionRow.id);

    return { error: null, session: sessionRow };
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
