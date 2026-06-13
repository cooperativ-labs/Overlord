import {
  isProtocolUsableSessionState,
  STALE_SESSION_REATTACH_MESSAGE
} from '@/lib/overlord/agent-session-lifecycle';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

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
    | 'discussion_summary'
    | 'decision'
    | 'ticket_reopened'
    | 'context_write'
    | 'context_read'
    | 'artifact'
    | 'deliver'
    | 'status_change'
    | 'alert'
    | 'awaiting_approval'
    | 'execution_requested';
  isBlocking?: boolean;
  payload?: Record<string, unknown>;
  phase?: string | null;
  objectiveId?: string | null;
  summary?: string | null;
  ticketId: string;
};

/**
 * Resolves an agent session by sessionKey + ticketId.
 * Joins through objectives to verify the session belongs to the supplied ticket.
 * When organizationId is provided, also verifies org membership.
 */
type ResolveSessionOptions = {
  allowCompletedReactivation?: boolean;
};

export async function resolveSession(
  sessionKey: string,
  ticketId: string,
  organizationId?: number,
  options?: ResolveSessionOptions
) {
  const supabase = createServiceRoleClient();

  let query = supabase
    .from('agent_sessions')
    .select('*, objective:objectives!inner(ticket_id, ticket:tickets!inner(organization_id))')
    .eq('session_key', sessionKey)
    .eq('objective.ticket_id', ticketId);

  if (organizationId !== undefined) {
    query = query.eq('objective.ticket.organization_id', organizationId);
  }

  const { data: session, error } = await query.single();

  if (error || !session) {
    return {
      error: 'Session not found for ticket.',
      session: null
    };
  }

  // Strip the joined data before returning the session row.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { objective: _objective, ...sessionRow } = session as typeof session & {
    objective: unknown;
  };

  const sessionState = sessionRow.session_state as Database['public']['Enums']['session_state'];
  if (
    !isProtocolUsableSessionState(sessionState, {
      allowCompletedReactivation: options?.allowCompletedReactivation
    })
  ) {
    return {
      error: STALE_SESSION_REATTACH_MESSAGE,
      session: null
    };
  }

  await supabase
    .from('agent_sessions')
    .update({ heartbeat_at: new Date().toISOString() })
    .eq('id', sessionRow.id);

  return { error: null, session: sessionRow };
}

export async function insertTicketEvent(input: EventInsert) {
  const supabase = createServiceRoleClient();
  return supabase.from('ticket_events').insert({
    event_type: input.eventType,
    is_blocking: input.isBlocking ?? false,
    payload: input.payload ?? {},
    phase: input.phase ?? null,
    objective_id: input.objectiveId ?? null,
    summary: input.summary ?? null,
    ticket_id: input.ticketId
  });
}
