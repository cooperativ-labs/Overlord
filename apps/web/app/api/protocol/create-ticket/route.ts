import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { deriveTitleFromObjective, getTicketIdentifier } from '@/lib/helpers/tickets';
import { insertOrderedObjectives } from '@/lib/objectives';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { resolveProtocolTicketCreatorUserId } from '@/lib/overlord/protocol-ticket-creator';
import { resolveTicketDelegate } from '@/lib/overlord/protocol-ticket-delegate';
import { resolveProjectIdOrName } from '@/lib/overlord/resolve-project';
import { createFollowUpTicketSchema } from '@/lib/overlord/validation';
import { resolvePreferredStatusNameByType } from '@/lib/ticket-statuses';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, createFollowUpTicketSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      acceptanceCriteria,
      availableTools,
      delegate,
      forHuman,
      objectives,
      priority,
      projectId,
      sessionKey,
      ticketId: rawTicketId,
      title
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const supabase = createServiceRoleClient();
    const createdBy = await resolveProtocolTicketCreatorUserId(supabase, {
      userId
    });
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }
    const ticketDelegate = resolveTicketDelegate(
      delegate,
      typeof resolved.session.metadata?.model === 'string' ? resolved.session.metadata.model : null,
      resolved.session.agent_identifier
    );

    const { data: sourceTicket, error: sourceTicketError } = await supabase
      .from('tickets')
      .select('id,organization_id,project_id,ticket_id')
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .single();

    if (sourceTicketError || !sourceTicket) {
      return NextResponse.json(
        { error: sourceTicketError?.message ?? 'Source ticket not found.' },
        { status: sourceTicketError?.code === 'PGRST116' ? 404 : 500 }
      );
    }

    let resolvedProjectId = sourceTicket.project_id;
    if (projectId) {
      const matchedProject = await resolveProjectIdOrName(supabase, organizationId, projectId);
      if (!matchedProject) {
        return NextResponse.json({ error: `Project not found: ${projectId}` }, { status: 404 });
      }
      resolvedProjectId = matchedProject.id;
    }

    const nextTitle = title.trim() || deriveTitleFromObjective(objectives[0].objective);
    const draftStatusName = await resolvePreferredStatusNameByType(
      supabase,
      sourceTicket.organization_id,
      'draft'
    );

    const { data: createdTicket, error: createTicketError } = await supabase
      .from('tickets')
      .insert({
        acceptance_criteria: acceptanceCriteria || null,
        available_tools: availableTools,
        created_by: createdBy,
        delegate: ticketDelegate,
        for_human: forHuman,
        organization_id: sourceTicket.organization_id,
        priority,
        project_id: resolvedProjectId,
        status: draftStatusName,
        title: nextTitle
      })
      .select('id,ticket_id,organization_id,project_id,for_human')
      .single();

    if (createTicketError || !createdTicket) {
      return NextResponse.json(
        { error: createTicketError?.message ?? 'Failed to create follow-up ticket.' },
        { status: 500 }
      );
    }

    const insertedObjectives = await insertOrderedObjectives(
      supabase,
      createdTicket.id,
      objectives,
      {
        createdBy,
        firstState: 'draft'
      }
    );

    const createdReference = getTicketIdentifier(createdTicket);
    const sourceReference = getTicketIdentifier(sourceTicket);

    const { error: childEventError } = await supabase.from('ticket_events').insert({
      event_type: 'system',
      payload: {
        created_from_ticket_id: ticketId,
        created_from_ticket_reference: sourceReference,
        created_via: 'protocol.create-ticket',
        delegate: ticketDelegate
      },
      objective_id: resolved.session.objective_id,
      summary: `Follow-up ticket created from ${sourceReference}.`,
      ticket_id: createdTicket.id,
      created_by: createdBy
    });

    if (childEventError) {
      return NextResponse.json({ error: childEventError.message }, { status: 500 });
    }

    const { error: sourceEventError } = await supabase.from('ticket_events').insert({
      event_type: 'update',
      payload: {
        created_ticket_id: createdTicket.id,
        created_ticket_reference: createdReference,
        created_ticket_for_human: createdTicket.for_human,
        delegate: ticketDelegate,
        entry_type: 'follow_up_ticket'
      },
      objective_id: resolved.session.objective_id,
      summary: `Created follow-up ticket ${createdReference} (${createdTicket.for_human ? 'human' : 'agent'}).`,
      ticket_id: ticketId,
      created_by: createdBy
    });

    if (sourceEventError) {
      return NextResponse.json({ error: sourceEventError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      objectives: insertedObjectives,
      ticket: {
        forHuman: createdTicket.for_human,
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
