import { after, NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { sendPushNotification } from '@/lib/overlord/push-notifications';
import { askSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, askSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { ticketId: rawTicketId, question, phase, payload, sessionKey } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    const supabase = createServiceRoleClient();
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id,ticket_id')
      .eq('id', ticketId)
      .maybeSingle();
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const { error: insertError } = await supabase.from('ticket_events').insert({
      event_type: 'question',
      is_blocking: true,
      payload,
      phase: phase ?? 'review',
      objective_id: resolved.session.objective_id,
      summary: question,
      ticket_id: ticketId,
      created_by: userId
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

    after(async () => {
      await sendPushNotification(supabase, {
        title: `Agent Question (${getTicketIdentifier(ticket ?? ticketId)})`,
        body: question || 'The agent is waiting for your input.',
        organizationId,
        data: { ticketId, eventType: 'question' }
      });
    });

    return NextResponse.json({
      ok: true,
      status: phase ?? 'review'
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
