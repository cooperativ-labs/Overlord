import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { resolveSession } from '@/lib/overlord/protocol-db';
import { createFollowUpTicketSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

function deriveTitleFromObjective(objective: string): string {
  const trimmed = objective.trim();
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 60)}…`;
}

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, createFollowUpTicketSchema);
  if (parsed.errorResponse || !parsed.data) {
    return parsed.errorResponse;
  }

  try {
    const {
      acceptanceCriteria,
      availableTools,
      executionTarget,
      objective,
      priority,
      sessionKey,
      ticketId,
      title
    } = parsed.data;

    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const { data: sourceTicket, error: sourceTicketError } = await supabase
      .from('tickets')
      .select('id,organization_id,project_id')
      .eq('id', ticketId)
      .single();

    if (sourceTicketError || !sourceTicket) {
      return NextResponse.json(
        { error: sourceTicketError?.message ?? 'Source ticket not found.' },
        { status: sourceTicketError?.code === 'PGRST116' ? 404 : 500 }
      );
    }

    const nextTitle = title.trim() || deriveTitleFromObjective(objective);

    const { data: createdTicket, error: createTicketError } = await supabase
      .from('tickets')
      .insert({
        acceptance_criteria: acceptanceCriteria || null,
        available_tools: availableTools,
        execution_target: executionTarget,
        objective,
        organization_id: sourceTicket.organization_id,
        priority,
        project_id: sourceTicket.project_id,
        status: 'draft',
        title: nextTitle
      })
      .select('id,organization_id,project_id,execution_target')
      .single();

    if (createTicketError || !createdTicket) {
      return NextResponse.json(
        { error: createTicketError?.message ?? 'Failed to create follow-up ticket.' },
        { status: 500 }
      );
    }

    const createdReference = getTicketIdentifier(createdTicket.id);
    const sourceReference = getTicketIdentifier(ticketId);

    const { error: childEventError } = await supabase.from('ticket_events').insert({
      event_type: 'system',
      payload: {
        created_from_ticket_id: ticketId,
        created_from_ticket_reference: sourceReference,
        created_via: 'protocol.create-ticket'
      },
      session_id: resolved.session.id,
      summary: `Follow-up ticket created from ${sourceReference}.`,
      ticket_id: createdTicket.id
    });

    if (childEventError) {
      return NextResponse.json({ error: childEventError.message }, { status: 500 });
    }

    const { error: sourceEventError } = await supabase.from('ticket_events').insert({
      event_type: 'update',
      payload: {
        created_ticket_id: createdTicket.id,
        created_ticket_reference: createdReference,
        created_ticket_execution_target: createdTicket.execution_target,
        entry_type: 'follow_up_ticket'
      },
      session_id: resolved.session.id,
      summary: `Created follow-up ticket ${createdReference} (${createdTicket.execution_target}).`,
      ticket_id: ticketId
    });

    if (sourceEventError) {
      return NextResponse.json({ error: sourceEventError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      ticket: {
        executionTarget: createdTicket.execution_target,
        id: createdTicket.id,
        organizationId: createdTicket.organization_id,
        projectId: createdTicket.project_id,
        reference: createdReference
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
