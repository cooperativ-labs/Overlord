import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { heartbeatSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, heartbeatSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      externalSessionId,
      externalUrl,
      note,
      percent,
      phase,
      sessionKey,
      ticketId: rawTicketId
    } = parsed.data;
    const { organizationId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const heartbeatAt = new Date().toISOString();
    const existingMetadata =
      resolved.session.metadata &&
      typeof resolved.session.metadata === 'object' &&
      !Array.isArray(resolved.session.metadata)
        ? resolved.session.metadata
        : {};

    const sessionUpdate: Record<string, unknown> = {
      heartbeat_at: heartbeatAt,
      metadata: {
        ...existingMetadata,
        overlordHeartbeat: {
          at: heartbeatAt,
          ...(phase ? { phase } : {}),
          ...(typeof percent === 'number' ? { percent } : {}),
          ...(note ? { note } : {})
        }
      }
    };

    if (externalUrl !== undefined) sessionUpdate.external_url = externalUrl;
    if (externalSessionId !== undefined) sessionUpdate.external_session_id = externalSessionId;

    const { error } = await supabase
      .from('agent_sessions')
      .update(sessionUpdate)
      .eq('id', resolved.session.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      heartbeatAt,
      telemetry: {
        ...(phase ? { phase } : {}),
        ...(typeof percent === 'number' ? { percent } : {}),
        ...(note ? { note } : {})
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
