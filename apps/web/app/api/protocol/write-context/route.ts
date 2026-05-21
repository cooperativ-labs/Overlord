import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { writeContextSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, writeContextSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { key, sessionKey, tags, ticketId: rawTicketId, value } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const { data: state, error: stateError } = await supabase
      .from('shared_state')
      .insert({
        objective_id: resolved.session.objective_id,
        state_key: key,
        state_value: value,
        tags,
        ticket_id: ticketId
      })
      .select('*')
      .single();

    if (stateError || !state) {
      return NextResponse.json(
        { error: stateError?.message ?? 'Failed to write shared state.' },
        { status: 500 }
      );
    }

    await supabase.from('ticket_events').insert({
      event_type: 'context_write',
      payload: { key, tags },
      objective_id: resolved.session.objective_id,
      summary: `Wrote context key ${key}.`,
      ticket_id: ticketId,
      created_by: userId
    });

    return NextResponse.json({
      context: state,
      ok: true
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
