import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { searchTicketsByTitle } from '@/lib/helpers/ticket-search';
import { SELECTED_ORG_COOKIE } from '@/lib/selected-org';
import { createClient } from '@/supabase/utils/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawQuery = (searchParams.get('q') ?? '').trim();
  if (!rawQuery) {
    return NextResponse.json({ tickets: [] });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cookieStore = await cookies();
  const selectedOrgValue = cookieStore.get(SELECTED_ORG_COOKIE)?.value;
  const parsedOrgId = selectedOrgValue ? Number(selectedOrgValue) : undefined;
  const organizationId =
    Number.isFinite(parsedOrgId ?? 0) && (parsedOrgId ?? 0) > 0 ? parsedOrgId : undefined;

  const { data, error } = await searchTicketsByTitle(supabase, {
    limit: 6,
    organizationId,
    query: rawQuery,
    select: 'id,title,ticket_sequence,project_id,organization_id,status,project:projects(name)'
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tickets: data ?? [] });
}
