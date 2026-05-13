import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { submitDraftObjective } from '@/lib/objectives';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { discussObjectiveSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, discussObjectiveSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { ticketId: rawTicketId, objectiveId } = parsed.data;
    const { organizationId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const supabase = createServiceRoleClient();

    const result = await submitDraftObjective(supabase, ticketId, objectiveId);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      didSubmit: result.didSubmit,
      objectiveId: result.submittedObjectiveId
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
