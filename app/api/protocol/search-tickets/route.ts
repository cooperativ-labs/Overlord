import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { searchTicketsByTitle } from '@/lib/helpers/ticket-search';
import { searchTicketsSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, searchTicketsSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await searchTicketsByTitle(supabase, {
      includeCompleted: parsed.data.includeCompleted,
      limit: parsed.data.limit,
      organizationId: parsed.tokenContext.organizationId,
      query: parsed.data.query
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      tickets: data ?? [],
      count: data?.length ?? 0
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
