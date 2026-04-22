import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { insertFileChanges } from '@/lib/overlord/file-changes';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { recordChangeRationalesSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, recordChangeRationalesSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { changeRationales, phase, sessionKey, summary, ticketId: rawTicketId } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const supabase = createServiceRoleClient();
    const typedSupabase = supabase as SupabaseClient<Database>;
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const rationaleCount = changeRationales.length;
    const eventSummary =
      summary ?? `Recorded ${rationaleCount} change rationale${rationaleCount === 1 ? '' : 's'}.`;

    const { data: event, error: eventError } = await supabase
      .from('ticket_events')
      .insert({
        event_type: 'update',
        payload: {
          change_rationale_count: rationaleCount,
          entry_type: 'file_changes'
        },
        phase: phase ?? null,
        session_id: resolved.session.id,
        summary: eventSummary,
        ticket_id: ticketId,
        created_by: userId
      })
      .select('id')
      .single();
    if (eventError || !event) {
      return NextResponse.json(
        { error: eventError?.message ?? 'Failed to create event.' },
        { status: 500 }
      );
    }

    const rationaleResult = await insertFileChanges({
      changeRationales,
      eventId: event.id,
      sessionId: resolved.session.id,
      supabase: typedSupabase,
      ticketId
    });
    if (rationaleResult.error) {
      return NextResponse.json({ error: rationaleResult.error }, { status: 500 });
    }

    return NextResponse.json({
      count: rationaleResult.count,
      ok: true
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
