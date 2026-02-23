'use server';

import { redirect } from 'next/navigation';

import { createClient } from '@/supabase/utils/server';
import { createProject, updateProjectWorkingDirectoryAction } from '@/lib/actions/projects';

export type OnboardingState = {
  userName: string | null;
  hasOrganizations: boolean;
  hasProjects: boolean;
  firstOrganizationId: number | null;
};

export async function getOnboardingState(): Promise<OnboardingState> {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const displayName =
    (user.user_metadata as { name?: string; full_name?: string })?.name ??
    (user.user_metadata as { name?: string; full_name?: string })?.full_name ??
    user.email?.split('@')[0] ??
    null;

  const { data: organizations, error: orgError } = await supabase
    .from('organizations')
    .select('id')
    .order('id', { ascending: true });

  if (orgError) {
    return {
      userName: displayName,
      hasOrganizations: false,
      hasProjects: false,
      firstOrganizationId: null
    };
  }

  const firstOrganizationId = organizations?.[0]?.id ?? null;
  const hasOrganizations = !!firstOrganizationId;

  if (!hasOrganizations) {
    return {
      userName: displayName,
      hasOrganizations: false,
      hasProjects: false,
      firstOrganizationId: null
    };
  }

  const { data: projects, error: projectsError } = await supabase
    .from('projects')
    .select('id')
    .eq('organization_id', firstOrganizationId)
    .limit(1);

  const hasProjects = !projectsError && !!projects && projects.length > 0;

  return {
    userName: displayName,
    hasOrganizations,
    hasProjects,
    firstOrganizationId
  };
}

export async function createFirstOrganization(input: { name: string }): Promise<{
  organizationId: number;
}> {
  const supabase = await createClient();
  const trimmedName = input.name.trim();

  const { data, error } = await supabase.rpc('create_organization_for_current_user', {
    target_name: trimmedName
  });

  if (error) {
    throw new Error(error.message ?? 'Failed to create organization.');
  }

  return { organizationId: data as number };
}

export async function createFirstProjectWithDirectory(input: {
  organizationId: number;
  name: string;
  color: string;
  workingDirectory: string | null;
}): Promise<{
  projectId: string;
  organizationId: number;
}> {
  const created = await createProject({
    organizationId: input.organizationId,
    name: input.name,
    color: input.color
  });

  await updateProjectWorkingDirectoryAction({
    projectId: created.id,
    workingDirectory: input.workingDirectory
  });

  return {
    projectId: created.id,
    organizationId: created.organizationId
  };
}

