import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { runConnectProtocol } from '@/lib/overlord/protocol-connect';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { connectSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, connectSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { ticketId: rawTicketId, agentIdentifier, connectionMethod, metadata } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const result = await runConnectProtocol(supabase, {
      ticketId,
      agentIdentifier,
      connectionMethod,
      metadata: metadata as Record<string, never>,
      organizationId,
      userId
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    return internalErrorResponse(error);
  }
}
