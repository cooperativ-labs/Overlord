import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveSession } from '@/lib/overlord/protocol-db';
import { decisionSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

function buildDecisionKey(title: string): string {
  const normalized = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const suffix = Math.floor(Date.now() / 1000);
  return `decision.${normalized || 'entry'}.${suffix}`;
}

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, decisionSchema);
  if (parsed.errorResponse || !parsed.data) {
    return parsed.errorResponse;
  }

  try {
    const { impact, payload, phase, rationale, sessionKey, ticketId, title } = parsed.data;
    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const decisionValue = {
      decided_at: new Date().toISOString(),
      impact: impact || null,
      rationale: rationale || null,
      title
    };

    const { data: state, error: stateError } = await supabase
      .from('shared_state')
      .insert({
        session_id: resolved.session.id,
        state_key: buildDecisionKey(title),
        state_value: decisionValue,
        tags: ['decision'],
        ticket_id: ticketId
      })
      .select('id')
      .single();

    if (stateError || !state) {
      return NextResponse.json(
        { error: stateError?.message ?? 'Failed to persist decision context.' },
        { status: 500 }
      );
    }

    const { error: eventError } = await supabase.from('ticket_events').insert({
      event_type: 'update',
      payload: {
        ...payload,
        entry_type: 'decision',
        impact: impact || null,
        parent_event_id: null,
        rationale: rationale || null,
        shared_state_id: state.id,
        title
      },
      phase: phase ?? null,
      session_id: resolved.session.id,
      summary: `Decision: ${title}`,
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
      ok: true,
      status: phase ?? null
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
