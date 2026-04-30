import { NextResponse } from 'next/server';

import { fetchProfileSettings } from '@/lib/actions/profile-settings';
import { searchTickets } from '@/lib/helpers/ticket-search';
import { createClientForRequest, getRequestSelectedOrganizationId } from '@/supabase/utils/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawQuery = (searchParams.get('q') ?? '').trim();
  if (!rawQuery) {
    return NextResponse.json({ tickets: [] });
  }

  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [{ data: memberRows }, profileSettings] = await Promise.all([
    supabase.from('members').select('organizations!inner(id)').eq('user_id', user.id),
    fetchProfileSettings(supabase, user.id)
  ]);

  const organizations = (memberRows ?? []).flatMap(row => {
    const organization = row.organizations;
    if (!organization) return [];
    return Array.isArray(organization) ? organization : [organization];
  });
  const organizationId = await getRequestSelectedOrganizationId({
    organizations,
    profilePreferences: profileSettings?.preferences
  });

  const { data, error } = await searchTickets(supabase, {
    limit: 6,
    organizationId: organizationId ?? undefined,
    query: rawQuery,
    select: 'id,title,ticket_sequence,project_id,organization_id,status,project:projects(name)'
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tickets: data ?? [] });
}
