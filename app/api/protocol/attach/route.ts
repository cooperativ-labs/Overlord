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

    const [{ data: ticket, error: ticketError }, { data: session, error: sessionError }] =
      await Promise.all([
        supabase
          .from('tickets')
          .select('*')
          .eq('id', ticketId)
          .eq('organization_id', organizationId)
          .single(),
        supabase
          .from('agent_sessions')
          .insert({
            agent_identifier: agentIdentifier,
            connection_method: connectionMethod,
            metadata,
            session_key: sessionKey,
            ticket_id: ticketId
          })
          .select('*')
          .single()
      ]);

    if (ticketError || !ticket) {
      return NextResponse.json(
        { error: ticketError?.message ?? 'Ticket not found.' },
        { status: ticketError?.code === 'PGRST116' ? 404 : 500 }
      );
    }
    if (sessionError || !session) {
      return NextResponse.json(
        { error: sessionError?.message ?? 'Failed to create session.' },
        { status: 500 }
      );
    }

    const objectiveExecution = await markDraftObjectiveExecuted(supabase, ticketId);

    await supabase.from('ticket_events').insert({
      event_type: 'system',
      payload: {
        agent_identifier: agentIdentifier,
        connection_method: connectionMethod
      },
      phase: ticket.status,
      session_id: session.id,
      summary: `${agentIdentifier} attached via ${connectionMethod}.`,
      ticket_id: ticketId
    });

    const [{ data: history }, { data: sharedState }] = await Promise.all([
      supabase
        .from('ticket_events')
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
