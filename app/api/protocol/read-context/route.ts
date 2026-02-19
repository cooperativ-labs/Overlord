import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveSession } from '@/lib/orchestrator/protocol-db';
import { readContextSchema } from '@/lib/orchestrator/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, readContextSchema);
  if (parsed.errorResponse || !parsed.data) {
    return parsed.errorResponse;
  }

  try {
    const { limit, query, sessionKey, ticketId } = parsed.data;
    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    let stateQuery = supabase
      .from('shared_state')
      .select('*')
      .or(`ticket_id.eq.${ticketId},ticket_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (query) {
      stateQuery = stateQuery.ilike('state_key', `%${query}%`);
    }

    const { data: rows, error } = await stateQuery;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from('ticket_events').insert({
      event_type: 'context_read',
      payload: { query },
      session_id: resolved.session.id,
      summary: query ? `Read context query: ${query}` : 'Read latest context entries.',
      ticket_id: ticketId
    });

    return NextResponse.json({
      context: rows ?? [],
      count: rows?.length ?? 0
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
