'use server';

import { cookies } from 'next/headers';

import { SELECTED_ORG_COOKIE } from '@/lib/selected-org';
import { createClient } from '@/supabase/utils/server';

export type UserOrganization = {
  id: number;
  name: string;
};

export async function getUserOrganizations(): Promise<UserOrganization[]> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }
  // Defensive membership join (defense in depth; RLS is primary authz).
  const { data } = await supabase
    .from('members')
    .select('organizations!inner(id,name)')
    .eq('user_id', user.id);
  const rows = (data ?? []) as { organizations: UserOrganization | UserOrganization[] | null }[];
  const orgs = rows.flatMap(row =>
    Array.isArray(row.organizations)
      ? row.organizations
      : row.organizations
        ? [row.organizations]
        : []
  );
  return orgs.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function setSelectedOrgAction(orgId: number | null): Promise<void> {
  const cookieStore = await cookies();
  if (orgId === null) {
    cookieStore.delete(SELECTED_ORG_COOKIE);
  } else {
    cookieStore.set(SELECTED_ORG_COOKIE, String(orgId), {
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
      sameSite: 'lax'
    });
  }
}
