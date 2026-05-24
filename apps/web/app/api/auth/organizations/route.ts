import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/supabase/utils/service-role';

/**
 * Lists organizations available to the current OAuth session.
 *
 * GET /api/auth/organizations
 * Authorization: Bearer <supabase-access-token>
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
  }

  const accessToken = authHeader.replace('Bearer ', '').trim();
  if (!accessToken) {
    return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    return NextResponse.json({ error: 'Invalid or expired token.' }, { status: 401 });
  }

  const { data: memberships, error: memberError } = await supabase
    .from('members')
    .select('organization_id, organizations(name)')
    .eq('user_id', user.id)
    .order('organization_id', { ascending: true });

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  return NextResponse.json({
    organizations: (memberships ?? []).map(row => {
      const organization = Array.isArray(row.organizations)
        ? row.organizations[0]
        : row.organizations;

      return {
        id: row.organization_id,
        name: organization?.name ?? ''
      };
    })
  });
}
