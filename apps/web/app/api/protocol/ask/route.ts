import { after, NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { emitWorkflowNotification } from '@/lib/overlord/notifications/orchestrator';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
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
      .select('id,ticket_id,title')
      .eq('id', ticketId)
      .maybeSingle();
    const ticketReference = getTicketIdentifier(ticket ?? ticketId);
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const insertedPhase = phase ?? 'review';
    const { data: insertedEvent, error: insertError } = await supabase
      .from('ticket_events')
      .insert({
        event_type: 'question',
        is_blocking: true,
        payload,
        phase: insertedPhase,
        objective_id: resolved.session.objective_id,
        summary: question,
        ticket_id: ticketId,
        created_by: userId
      })
      .select('id')
      .single();
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
      await emitWorkflowNotification({
        supabase,
        event: {
          id: insertedEvent?.id ?? null,
          event_type: 'question',
          is_blocking: true,
          payload,
          phase: insertedPhase,
          summary: question
        },
        organizationId,
        ticketId,
        ticketReference,
        ticketTitle: ticket?.title ?? null,
        objectiveId: resolved.session.objective_id
      });
    });

    return NextResponse.json({
      ok: true,
      status: insertedPhase
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
