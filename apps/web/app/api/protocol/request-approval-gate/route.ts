import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { requestApprovalGateSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, requestApprovalGateSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { ticketId: rawTicketId, sessionKey, reason, objectiveId } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    let targetObjective: {
      id: string;
      auto_advance: boolean | null;
      approval_reason: string | null;
    } | null = null;

    if (objectiveId) {
      const { data } = await supabase
        .from('objectives')
        .select('id, auto_advance, approval_reason')
        .eq('id', objectiveId)
        .eq('ticket_id', ticketId)
        .maybeSingle();
      targetObjective = data ?? null;
    } else {
      const { data } = await supabase
        .from('objectives')
        .select('id, auto_advance, approval_reason')
        .eq('ticket_id', ticketId)
        .eq('state', 'future')
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      targetObjective = data ?? null;
    }

    if (!targetObjective) {
      return NextResponse.json(
        { error: 'No queued future objective is available to gate.' },
        { status: 404 }
      );
    }

    const previousAutoAdvance = targetObjective.auto_advance !== false;

    const { error: updateError } = await supabase
      .from('objectives')
      .update({
        auto_advance: false,
        approval_reason: reason
      })
      .eq('id', targetObjective.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await supabase.from('ticket_events').insert({
      event_type: 'update',
      phase: 'execute',
      summary: `Requested approval gate on next objective: ${reason}`,
      ticket_id: ticketId,
      objective_id: targetObjective.id,
      created_by: userId
    });

    return NextResponse.json({
      ok: true,
      objectiveId: targetObjective.id,
      previousAutoAdvance,
      autoAdvance: false
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
