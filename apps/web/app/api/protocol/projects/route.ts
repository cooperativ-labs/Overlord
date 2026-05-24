// UI-private — not exposed via CLI/MCP by design. Powers the Overlord
// desktop/web project picker; agents resolve projects via discover-project.
import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { resolveAgentToken } from '@/lib/overlord/protocol-auth';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

function getOrganizationName(
  organization: { name: string } | Array<{ name: string }> | null | undefined
) {
  if (!organization) return null;
  if (Array.isArray(organization)) return organization[0]?.name ?? null;
  return organization.name ?? null;
}

export async function GET(request: Request) {
  const authResult = await resolveAgentToken(request);
  if (authResult.error) return authResult.error;

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('projects')
      .select('id,name,organization_id,organization:organizations(name)')
      .eq('organization_id', authResult.context.organizationId)
      .order('name', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'No projects found' }, { status: 404 });
    }

    return NextResponse.json({
      count: data?.length ?? 0,
      projects:
        data?.map(project => ({
          id: project.id,
          name: project.name,
          organizationId: project.organization_id,
          organizationName: getOrganizationName(project.organization)
        })) ?? []
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
