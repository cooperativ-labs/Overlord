import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { runLoadContextProtocol } from '@/lib/overlord/protocol-load-context';
import { loadContextSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, loadContextSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { ticketId: rawTicketId } = parsed.data;
    const { organizationId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const result = await runLoadContextProtocol(supabase, { ticketId, organizationId });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    return internalErrorResponse(error);
  }
}
