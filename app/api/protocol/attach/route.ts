import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { markDraftObjectiveExecuted } from '@/lib/objectives';
import { attachSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, attachSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { ticketId, agentIdentifier, connectionMethod, metadata } = parsed.data;
    const { organizationId } = parsed.tokenContext;
    const sessionKey = randomUUID();

    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json(
        { error: 'Ticket not found.' },
        { status: ticketError?.code === 'PGRST116' ? 404 : 500 }
      );
    }

    const { data: session, error: sessionError } = await supabase
      .from('agent_sessions')
      .insert({
        agent_identifier: agentIdentifier,
        connection_method: connectionMethod,
        metadata,
        session_key: sessionKey,
        ticket_id: ticketId
      })
      .select('*')
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Failed to create session.' }, { status: 500 });
    }

    const objectiveExecution = await markDraftObjectiveExecuted(supabase, ticketId);

    const previousStatus = ticket.status;
    const isResumeAfterDelivery = previousStatus === 'review' || previousStatus === 'complete';

    // Automatically move the ticket to 'execute' status when an agent attaches
    await supabase.from('tickets').update({ status: 'execute' }).eq('id', ticketId);

    await supabase.from('ticket_events').insert({
      event_type: 'system',
      payload: {
        agent_identifier: agentIdentifier,
        connection_method: connectionMethod
      },
      phase: previousStatus,
      session_id: session.id,
      summary: `${agentIdentifier} attached via ${connectionMethod}.`,
      ticket_id: ticketId
    });

    // If the ticket was previously delivered/reviewed and is now being resumed,
    // emit a ticket_reopened event so the UI reflects the transition back to execution state.
    if (isResumeAfterDelivery) {
      await supabase.from('ticket_events').insert({
        event_type: 'ticket_reopened',
        phase: 'execute',
        session_id: session.id,
        summary: 'Ticket reopened — resumed from delivered state.',
        ticket_id: ticketId
      });
    }

    const [{ data: history }, { data: artifacts }, { data: sharedState }] = await Promise.all([
      supabase
        .from('ticket_events')
        .select('*')
        .eq('ticket_id', ticketId)
        .eq('event_type', 'deliver')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('artifacts')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('shared_state')
        .select('*')
        .or(`ticket_id.eq.${ticketId},ticket_id.is.null`)
        .order('created_at', { ascending: false })
        .limit(50)
    ]);

    return NextResponse.json({
      history: history ?? [],
      artifacts: artifacts ?? [],
      session: {
        id: session.id,
        sessionKey: session.session_key,
        state: session.session_state
      },
      sharedState: sharedState ?? [],
      ticket: {
        ...ticket,
        objective: objectiveExecution.executedObjective ?? ticket.objective
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
