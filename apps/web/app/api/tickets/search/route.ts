import { NextResponse } from 'next/server';

import { fetchProfileSettings } from '@/lib/actions/profile-settings';
import { searchTickets } from '@/lib/helpers/ticket-search';
import {
  createClientForRequest,
  getRequestDefaultProjectId,
  getRequestSelectedOrganizationId
} from '@/supabase/utils/server';

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
  const defaultProjectId = await getRequestDefaultProjectId({
    profileDefaultProjectId: profileSettings?.default_project_id ?? null
  });
  let defaultProjectOrganizationId: number | null = null;
  if (defaultProjectId) {
    const { data: defaultProject } = await supabase
      .from('projects')
      .select('organization_id')
      .eq('id', defaultProjectId)
      .maybeSingle();
    defaultProjectOrganizationId = defaultProject?.organization_id ?? null;
  }

  const organizations = (memberRows ?? []).flatMap(row => {
    const organization = row.organizations;
    if (!organization) return [];
    return Array.isArray(organization) ? organization : [organization];
  });
  const organizationId = await getRequestSelectedOrganizationId({
    defaultProjectOrganizationId,
    organizations
  });

  const { data, error } = await searchTickets(supabase, {
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
