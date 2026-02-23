import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { listTicketsSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, listTicketsSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { organizationId } = parsed.tokenContext;
    const supabase = createServiceRoleClient();
    let query = supabase
      .from('tickets')
      .select('*')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false });

    if (!parsed.data.includeCompleted) {
      query = query.neq('status', 'complete');
    }
    if (parsed.data.statuses?.length) {
      query = query.in('status', parsed.data.statuses);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      tickets: data,
      count: data.length
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
