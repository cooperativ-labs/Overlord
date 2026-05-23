'use server';

import * as Sentry from '@sentry/nextjs';
import { cookies } from 'next/headers';

import {
  activeOrgPreferenceToCookieValue,
  mergeActiveOrgPreferenceIntoProfile,
  SELECTED_ORG_COOKIE
} from '@/lib/active-organization-preference';
import { ORGANIZATION_ROLE_ORDER, type OrganizationRole } from '@/lib/organization-roles';
import { createClientForRequest } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

const ORG_IMAGES_BUCKET = 'org-images';
const MAX_ORG_IMAGE_BYTES = 5 * 1024 * 1024;

function sanitizeOrgImageFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[\\/\0]/g, '-')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized ? sanitized.slice(0, 120) : 'logo';
}

function getOwnedOrgImageStoragePath(logoUrl: string, organizationId: number): string | null {
  if (!logoUrl) return null;
  try {
    const url = new URL(logoUrl);
    const prefix = `/storage/v1/object/public/${ORG_IMAGES_BUCKET}/`;
    const prefixIndex = url.pathname.indexOf(prefix);
    if (prefixIndex < 0) return null;
    const storagePath = decodeURIComponent(url.pathname.slice(prefixIndex + prefix.length));
    return storagePath.startsWith(`${organizationId}/`) ? storagePath : null;
  } catch {
    return null;
  }
}

export async function uploadOrganizationLogoAction(
  organizationId: number,
  formData: FormData
): Promise<string> {
  const file = formData.get('file');
  if (!(file instanceof File)) throw new Error('No image provided.');
  if (!file.type.startsWith('image/')) throw new Error('Please upload an image file.');
  if (file.size > MAX_ORG_IMAGE_BYTES) throw new Error('Image must be 5 MB or smaller.');

  const supabase = await createClientForRequest();
  const userId = await requireUserId();

  const { data: existingOrg } = await supabase
    .from('organizations')
    .select('logo_url')
    .eq('id', organizationId)
    .single();

  const previousStoragePath = existingOrg?.logo_url
    ? getOwnedOrgImageStoragePath(existingOrg.logo_url, organizationId)
    : null;

  const storagePath = `${organizationId}/${Date.now()}-${sanitizeOrgImageFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(ORG_IMAGES_BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', upsert: false });

  if (uploadError) throw new Error(uploadError.message ?? 'Failed to upload image.');

  const {
    data: { publicUrl }
  } = supabase.storage.from(ORG_IMAGES_BUCKET).getPublicUrl(storagePath);

  const { error: updateError } = await supabase
    .from('organizations')
    .update({ logo_url: publicUrl })
    .eq('id', organizationId);

  if (updateError) {
    await supabase.storage.from(ORG_IMAGES_BUCKET).remove([storagePath]);
    throw new Error(updateError.message ?? 'Failed to save logo URL.');
  }

  if (previousStoragePath) {
    const { error: removeError } = await supabase.storage
      .from(ORG_IMAGES_BUCKET)
      .remove([previousStoragePath]);
    if (removeError) {
      console.warn('Failed to remove previous org logo:', removeError.message);
      Sentry.captureMessage(
        `Failed to remove previous org logo: ${removeError.message}`,
        'warning'
      );
    }
  }

  return publicUrl;
}

export async function removeOrganizationLogoAction(organizationId: number): Promise<void> {
  const supabase = await createClientForRequest();
  await requireUserId();

  const { data: existingOrg } = await supabase
    .from('organizations')
    .select('logo_url')
    .eq('id', organizationId)
    .single();

  const currentStoragePath = existingOrg?.logo_url
    ? getOwnedOrgImageStoragePath(existingOrg.logo_url, organizationId)
    : null;

  const { error } = await supabase
    .from('organizations')
    .update({ logo_url: null })
    .eq('id', organizationId);

  if (error) throw new Error(error.message ?? 'Failed to remove logo.');

  if (currentStoragePath) {
    const { error: removeError } = await supabase.storage
      .from(ORG_IMAGES_BUCKET)
      .remove([currentStoragePath]);
    if (removeError) {
      console.warn('Failed to remove org logo object:', removeError.message);
      Sentry.captureMessage(`Failed to remove org logo object: ${removeError.message}`, 'warning');
    }
  }
}

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
  logo_url: string | null;
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
    .select('organizations!inner(id,name,logo_url)')
    .eq('user_id', user.id);
  const rows = (data ?? []) as { organizations: UserOrganization | UserOrganization[] | null }[];
  const orgs = rows.flatMap(row =>
    Array.isArray(row.organizations)
      ? row.organizations
      : row.organizations
        ? [row.organizations]
        : []
  );
  return orgs
    .map(({ id, name, logo_url }) => ({ id, name, logo_url: logo_url ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

export type GitProvider = 'github' | 'bitbucket';

export type OrganizationDetails = {
  id: number;
  name: string;
  feedRetentionDays: number;
  gitProvider: GitProvider | null;
  logoUrl: string | null;
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
      .select('id,name,feed_retention_days,git_provider,logo_url')
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
    gitProvider: (orgResult.data.git_provider as GitProvider | null) ?? null,
    logoUrl: orgResult.data.logo_url ?? null,
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

export async function updateOrganizationGitProviderAction(
  organizationId: number,
  gitProvider: GitProvider | null
): Promise<GitProvider | null> {
  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('organizations')
    .update({ git_provider: gitProvider })
    .eq('id', organizationId)
    .select('git_provider')
    .single();

  if (error) {
    throw new Error(error.message ?? 'Failed to update git provider.');
  }
  return (data.git_provider as GitProvider | null) ?? null;
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

export async function updateMemberRoleAction(
  organizationId: number,
  userId: string,
  role: OrganizationRole
): Promise<{ error?: string }> {
  const supabase = await createClientForRequest();
  const currentUserId = await requireUserId();

  // Check caller is ADMIN or MANAGER
  const { data: callerMember } = await supabase
    .from('members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', currentUserId)
    .maybeSingle();

  if (!callerMember) return { error: 'Unauthorized' };
  const callerRole = callerMember.role as OrganizationRole;
  if (callerRole !== 'ADMIN' && callerRole !== 'MANAGER') {
    return { error: 'Only Admins and Managers can change member roles.' };
  }

  const callerLevel = ORGANIZATION_ROLE_ORDER.indexOf(callerRole);
  const newRoleLevel = ORGANIZATION_ROLE_ORDER.indexOf(role);

  // Ensure at least one ADMIN remains if demoting the last ADMIN
  const { data: targetMember } = await supabase
    .from('members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!targetMember) return { error: 'Member not found.' };

  const targetLevel = ORGANIZATION_ROLE_ORDER.indexOf(targetMember.role as OrganizationRole);
  if (callerLevel < 0 || newRoleLevel < 0 || targetLevel < 0) {
    return { error: 'Invalid role.' };
  }
  if (newRoleLevel > callerLevel) {
    return { error: 'You cannot assign a role higher than your own.' };
  }
  if (targetLevel > callerLevel) {
    return { error: 'You cannot change the role of someone who outranks you.' };
  }

  if (targetMember.role === 'ADMIN' && role !== 'ADMIN') {
    const { count } = await supabase
      .from('members')
      .select('user_id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('role', 'ADMIN');

    if ((count ?? 0) <= 1) {
      return { error: 'Cannot demote the last Admin. Promote another member to Admin first.' };
    }
  }

  const { error } = await supabase
    .from('members')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('user_id', userId);

  if (error) return { error: error.message ?? 'Failed to update role.' };
  return {};
}

export async function removeMemberAction(
  organizationId: number,
  userId: string
): Promise<{ error?: string }> {
  const supabase = await createClientForRequest();
  const currentUserId = await requireUserId();

  if (userId === currentUserId) {
    return { error: 'Use "Leave organization" to remove yourself.' };
  }

  const { data: callerMember } = await supabase
    .from('members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', currentUserId)
    .maybeSingle();

  if (!callerMember) return { error: 'Unauthorized' };
  const callerRole = callerMember.role as OrganizationRole;
  if (callerRole !== 'ADMIN' && callerRole !== 'MANAGER') {
    return { error: 'Only Admins and Managers can remove members.' };
  }

  const callerLevel = ORGANIZATION_ROLE_ORDER.indexOf(callerRole);

  // Prevent removing the last ADMIN
  const { data: targetMember } = await supabase
    .from('members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!targetMember) return { error: 'Member not found.' };

  const targetLevel = ORGANIZATION_ROLE_ORDER.indexOf(targetMember.role as OrganizationRole);
  if (callerLevel < 0 || targetLevel < 0) {
    return { error: 'Invalid role.' };
  }
  if (targetLevel > callerLevel) {
    return { error: 'You cannot remove someone who outranks you.' };
  }

  if (targetMember.role === 'ADMIN') {
    const { count } = await supabase
      .from('members')
      .select('user_id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('role', 'ADMIN');

    if ((count ?? 0) <= 1) {
      return { error: 'Cannot remove the last Admin.' };
    }
  }

  const { error } = await supabase
    .from('members')
    .delete()
    .eq('organization_id', organizationId)
    .eq('user_id', userId);

  if (error) return { error: error.message ?? 'Failed to remove member.' };
  return {};
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
