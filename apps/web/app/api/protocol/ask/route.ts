import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { askSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, askSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { ticketId: rawTicketId, question, phase, payload, sessionKey } = parsed.data;
    const { organizationId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const { error: insertError } = await supabase.from('ticket_events').insert({
      event_type: 'question',
      is_blocking: true,
      payload,
      phase: phase ?? 'review',
      session_id: resolved.session.id,
      summary: question,
      ticket_id: ticketId
    });
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const { error: ticketError } = await supabase
      .from('tickets')
      .update({ status: phase ?? 'review', is_read: false })
      .eq('id', ticketId);
    if (ticketError) {
      return NextResponse.json({ error: ticketError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      status: phase ?? 'review'
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
