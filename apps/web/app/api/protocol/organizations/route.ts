import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { listOrganizationsSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

/**
 * Lists every organization the authenticated principal belongs to.
 *
 * Unlike `/api/auth/organizations` (which only accepts a Supabase OAuth access
 * token), this protocol endpoint resolves the caller through the standard
 * protocol auth path, so it works for OAuth sessions, per-user agent tokens, and
 * local dev tokens alike. The runner uses it to poll every organization the user
 * belongs to instead of being limited to the single org stored in credentials.
 */
export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, listOrganizationsSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { data: memberships, error } = await supabase
      .from('members')
      .select('organization_id, organizations(name)')
      .eq('user_id', userId)
      .order('organization_id', { ascending: true });

    if (error) return internalErrorResponse(error);

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
  } catch (error) {
    return internalErrorResponse(error);
  }
}
