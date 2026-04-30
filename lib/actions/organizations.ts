'use server';

import { cookies } from 'next/headers';

import {
  activeOrgPreferenceToCookieValue,
  mergeActiveOrgPreferenceIntoProfile,
  SELECTED_ORG_COOKIE
} from '@/lib/active-organization-preference';
import { createClientForRequest } from '@/supabase/utils/server';

export async function createOrganizationAction(input: { name: string }): Promise<{
  organizationId: number;
}> {
  const supabase = await createClientForRequest();
  const trimmedName = input.name.trim();

  const { data, error } = await supabase.rpc('create_organization_for_current_user', {
    target_name: trimmedName
  });

  if (error) {
    throw new Error(error.message ?? 'Failed to create organization.');
  }

  return { organizationId: data as number };
}

export type UserOrganization = {
  id: number;
  name: string;
};

export async function getUserOrganizations(): Promise<UserOrganization[]> {
  const supabase = await createClientForRequest();
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

/**
 * Persists the user's active organization preference.
 *
 * Writes to the canonical DB-backed preference (profiles.preferences.active_organization_id)
 * so it syncs across devices, then mirrors the value into the selected-org cookie
 * so subsequent SSR requests on web don't need a DB round-trip. Electron requests
 * resolve the preference directly from the DB and ignore the cookie.
 *
 * orgId === null means "All organizations" (an explicit, canonical selection).
 */
export async function setSelectedOrgAction(orgId: number | null): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('preferences')
      .eq('id', user.id)
      .maybeSingle();

    const merged = mergeActiveOrgPreferenceIntoProfile(existing?.preferences ?? null, orgId);
    const { error } = await supabase
      .from('profiles')
      .update({ preferences: merged })
      .eq('id', user.id);

    if (error) {
      throw new Error(error.message ?? 'Failed to save active organization preference.');
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(SELECTED_ORG_COOKIE, activeOrgPreferenceToCookieValue(orgId), {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax'
  });
}
