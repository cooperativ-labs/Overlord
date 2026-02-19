import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveSession } from '@/lib/orchestrator/protocol-db';
import { updateSchema } from '@/lib/orchestrator/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, updateSchema);
  if (parsed.errorResponse || !parsed.data) {
    return parsed.errorResponse;
  }

  try {
    const { payload, phase, sessionKey, summary, ticketId } = parsed.data;
    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const { error: eventError } = await supabase.from('ticket_events').insert({
      event_type: 'update',
      payload,
      phase: phase ?? null,
      session_id: resolved.session.id,
      summary,
      ticket_id: ticketId
    });
    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    }

    if (phase) {
      const { error: ticketError } = await supabase
        .from('tickets')
        .update({ status: phase })
        .eq('id', ticketId);
      if (ticketError) {
        return NextResponse.json({ error: ticketError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
