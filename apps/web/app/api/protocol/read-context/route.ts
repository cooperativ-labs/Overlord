import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { readContextSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, readContextSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { limit, query, sessionKey, ticketId: rawTicketId } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    let stateQuery = supabase
      .from('shared_state')
      .select('*')
      .or(`ticket_id.eq.${ticketId},ticket_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (query) {
      stateQuery = stateQuery.ilike('state_key', `%${query}%`);
    }

    const { data: rows, error } = await stateQuery;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from('ticket_events').insert({
      event_type: 'context_read',
      payload: { query },
      session_id: resolved.session.id,
      summary: query ? `Read context query: ${query}` : 'Read latest context entries.',
      ticket_id: ticketId,
      created_by: userId
    });

    return NextResponse.json({
      context: rows ?? [],
      count: rows?.length ?? 0
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
