'use server';

import { cookies } from 'next/headers';

import {
  activeOrgPreferenceToCookieValue,
  mergeActiveOrgPreferenceIntoProfile,
  SELECTED_ORG_COOKIE
} from '@/lib/active-organization-preference';
import { createClientForRequest } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

export type OrganizationRole = Database['public']['Enums']['organization_role'];

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

export type OrganizationDetails = {
  id: number;
  name: string;
  feedRetentionDays: number;
  role: OrganizationRole | null;
};

async function requireUserId(): Promise<string> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user.id;
}

export async function getOrganizationDetailsAction(
  organizationId: number
): Promise<OrganizationDetails> {
  const supabase = await createClientForRequest();
  const userId = await requireUserId();

  const [orgResult, memberResult] = await Promise.all([
    supabase
      .from('organizations')
      .select('id,name,feed_retention_days')
      .eq('id', organizationId)
      .single(),
    supabase
      .from('members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle()
  ]);

  if (orgResult.error || !orgResult.data) {
    throw new Error(orgResult.error?.message ?? 'Organization not found.');
  }

  return {
    id: orgResult.data.id,
    name: orgResult.data.name,
    feedRetentionDays: orgResult.data.feed_retention_days,
    role: (memberResult.data?.role as OrganizationRole | undefined) ?? null
  };
}

export async function updateOrganizationNameAction(
  organizationId: number,
  name: string
): Promise<string> {
  const supabase = await createClientForRequest();
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Name cannot be empty.');
  }

  const { data, error } = await supabase
    .from('organizations')
    .update({ name: trimmed })
    .eq('id', organizationId)
    .select('name')
    .single();

  if (error) {
    throw new Error(error.message ?? 'Failed to update organization name.');
  }
  return data.name;
}

export async function updateOrganizationFeedRetentionDaysAction(
  organizationId: number,
  days: number
): Promise<number> {
  if (days < 1 || days > 365) {
    throw new Error('Retention must be between 1 and 365 days.');
  }
  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('organizations')
    .update({ feed_retention_days: days })
    .eq('id', organizationId)
    .select('feed_retention_days')
    .single();

  if (error) {
    throw new Error(error.message ?? 'Failed to update feed retention.');
  }
  return data.feed_retention_days;
}

export type OrganizationMember = {
  userId: string;
  role: OrganizationRole;
  joinedAt: string;
  email: string | null;
  displayName: string | null;
  isCurrentUser: boolean;
};

export async function getOrganizationMembersAction(
  organizationId: number
): Promise<OrganizationMember[]> {
  const supabase = await createClientForRequest();
  const currentUserId = await requireUserId();

  const { data: memberRows, error } = await supabase
    .from('members')
    .select('user_id, role, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message ?? 'Failed to load members.');
  }

  const members = memberRows ?? [];
  const userIds = members.map(m => m.user_id);
  const profilesById = new Map<string, { email: string | null; name: string | null }>();
  if (userIds.length > 0) {
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, email, name')
      .in('id', userIds);
    for (const row of profileRows ?? []) {
      profilesById.set(row.id, { email: row.email ?? null, name: row.name ?? null });
    }
  }

  return members.map(row => {
    const profile = profilesById.get(row.user_id);
    return {
      userId: row.user_id,
      role: row.role as OrganizationRole,
      joinedAt: row.created_at,
      email: profile?.email ?? null,
      displayName: profile?.name ?? null,
      isCurrentUser: row.user_id === currentUserId
    };
  });
}

export async function leaveOrganizationAction(organizationId: number): Promise<void> {
  const supabase = await createClientForRequest();
  const userId = await requireUserId();

  const { error } = await supabase
    .from('members')
    .delete()
    .eq('organization_id', organizationId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(error.message ?? 'Failed to leave organization.');
  }
}
