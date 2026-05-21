import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { insertOrderedObjectives } from '@/lib/objectives';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { resolveProtocolTicketCreatorUserId } from '@/lib/overlord/protocol-ticket-creator';
import { addObjectivesSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, addObjectivesSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { ticketId: rawTicketId, objectives } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const supabase = createServiceRoleClient();
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('id,ticket_id,organization_id,project_id')
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json(
        { error: ticketError?.message ?? 'Ticket not found.' },
        { status: ticketError?.code === 'PGRST116' ? 404 : 500 }
      );
    }

    const createdBy = await resolveProtocolTicketCreatorUserId(supabase, { userId });
    const insertedObjectives = await insertOrderedObjectives(supabase, ticket.id, objectives, {
      createdBy,
      firstStateWhenNoActive: 'draft',
      firstStateWhenActive: 'future',
      followingState: 'future'
    });
    const reference = getTicketIdentifier(ticket);

    const { error: eventError } = await supabase.from('ticket_events').insert({
      created_by: createdBy,
      event_type: 'update',
      payload: {
        appended_objective_count: insertedObjectives.length,
        created_via: 'protocol.add-objectives',
        objective_ids: insertedObjectives.map(objective => objective.id)
      },
      summary: `Added ${insertedObjectives.length} objective${insertedObjectives.length === 1 ? '' : 's'} to ${reference}.`,
      ticket_id: ticket.id
    });

    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      objectives: insertedObjectives,
      ticket: {
        id: ticket.id,
        organizationId: ticket.organization_id,
        projectId: ticket.project_id,
        reference
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
