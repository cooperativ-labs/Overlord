'use server';

import * as Sentry from '@sentry/nextjs';
import { redirect } from 'next/navigation';

import { createProject, updateProjectWorkingDirectoryAction } from '@/lib/actions/projects';
import type { AgentTypeValue } from '@/lib/helpers/agent-types';
import { createClient } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export type OnboardingProgress = {
  completedStep: number;
  skipped: boolean;
  preferredAgent?: AgentTypeValue;
  desktopSetupDone?: boolean;
  desktopCompletedStep?: number;
};

export type OnboardingState = {
  userName: string | null;
  hasOrganizations: boolean;
  hasProjects: boolean;
  firstOrganizationId: number | null;
  onboardingCompletedStep: number;
  onboardingSkipped: boolean;
  preferredAgent?: AgentTypeValue;
  desktopSetupDone: boolean;
  desktopCompletedStep: number;
};

function parseOnboardingProgress(raw: unknown): OnboardingProgress {
  if (!raw || typeof raw !== 'object') {
    return { completedStep: 0, skipped: false };
  }
  const obj = raw as Record<string, unknown>;
  return {
    completedStep: typeof obj['completed_step'] === 'number' ? obj['completed_step'] : 0,
    skipped: typeof obj['skipped'] === 'boolean' ? obj['skipped'] : false,
    preferredAgent:
      typeof obj['preferred_agent'] === 'string'
        ? (obj['preferred_agent'] as AgentTypeValue)
        : undefined,
    desktopSetupDone:
      typeof obj['desktop_setup_done'] === 'boolean' ? obj['desktop_setup_done'] : false,
    desktopCompletedStep:
      typeof obj['desktop_completed_step'] === 'number' ? obj['desktop_completed_step'] : 0
  };
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/(auth)/login');
  }

  const displayName =
    (user.user_metadata as { name?: string; full_name?: string })?.name ??
    (user.user_metadata as { name?: string; full_name?: string })?.full_name ??
    user.email?.split('@')[0] ??
    null;

  // Load profile onboarding progress in parallel with org/project queries
  const [profileResult, orgResult] = await Promise.all([
    supabase.from('profiles').select('onboarding').eq('id', user.id).maybeSingle(),
    supabase.from('organizations').select('id').order('id', { ascending: true })
  ]);

  const progress = parseOnboardingProgress(profileResult.data?.onboarding);

  if (orgResult.error) {
    return {
      userName: displayName,
      hasOrganizations: false,
      hasProjects: false,
      firstOrganizationId: null,
      onboardingCompletedStep: progress.completedStep,
      onboardingSkipped: progress.skipped,
      preferredAgent: progress.preferredAgent,
      desktopSetupDone: progress.desktopSetupDone ?? false,
      desktopCompletedStep: progress.desktopCompletedStep ?? 0
    };
  }

  const firstOrganizationId = orgResult.data?.[0]?.id ?? null;
  const hasOrganizations = !!firstOrganizationId;

  if (!hasOrganizations) {
    return {
      userName: displayName,
      hasOrganizations: false,
      hasProjects: false,
      firstOrganizationId: null,
      onboardingCompletedStep: progress.completedStep,
      onboardingSkipped: progress.skipped,
      preferredAgent: progress.preferredAgent,
      desktopSetupDone: progress.desktopSetupDone ?? false,
      desktopCompletedStep: progress.desktopCompletedStep ?? 0
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
    firstOrganizationId,
    onboardingCompletedStep: progress.completedStep,
    onboardingSkipped: progress.skipped,
    preferredAgent: progress.preferredAgent,
    desktopSetupDone: progress.desktopSetupDone ?? false,
    desktopCompletedStep: progress.desktopCompletedStep ?? 0
  };
}

export async function updateOnboardingProgressAction(update: {
  completedStep?: number;
  skipped?: boolean;
  preferredAgent?: AgentTypeValue;
  desktopSetupDone?: boolean;
  desktopCompletedStep?: number;
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Not authenticated');
  }

  // Read current value, merge, write back
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding')
    .eq('id', user.id)
    .maybeSingle();

  const current = parseOnboardingProgress(profile?.onboarding);

  const next = {
    completed_step:
      update.completedStep !== undefined
        ? Math.max(current.completedStep, update.completedStep)
        : current.completedStep,
    skipped: update.skipped !== undefined ? update.skipped : current.skipped,
    preferred_agent:
      update.preferredAgent !== undefined ? update.preferredAgent : current.preferredAgent,
    desktop_setup_done:
      update.desktopSetupDone !== undefined
        ? update.desktopSetupDone
        : (current.desktopSetupDone ?? false),
    desktop_completed_step:
      update.desktopCompletedStep !== undefined
        ? Math.max(current.desktopCompletedStep ?? 0, update.desktopCompletedStep)
        : (current.desktopCompletedStep ?? 0)
  };

  const { error } = await supabase.from('profiles').update({ onboarding: next }).eq('id', user.id);

  if (error) {
    throw new Error(error.message ?? 'Failed to update onboarding progress.');
  }
}

export async function getDefaultAgentTokenAction(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from('agent_tokens')
    .select('token')
    .eq('user_id', user.id)
    .eq('name', 'Default CLI Token')
    .is('revoked_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.token ?? null;
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

  const organizationId = data as number;

  // Auto-create a default agent token for this user + org
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user) {
    const serviceSupabase = createServiceRoleClient();
    const { error: tokenError } = await serviceSupabase.from('agent_tokens').insert({
      user_id: user.id,
      organization_id: organizationId,
      name: 'Default CLI Token'
    });
    if (tokenError) {
      Sentry.captureException(
        new Error(`Failed to create default agent token: ${tokenError.message}`)
      );
    }
  }

  return { organizationId };
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

  // Only persist a working directory when the user actually picked one.
  // The upsert is a separate round-trip that can race with Supabase's
  // refresh-token rotation mid-request; if we always fire it — even for
  // null directories — we double the chance of session churn and surface
  // Next.js' generic "An unexpected response was received from the server"
  // when the second call fails after the project has already been created.
  const trimmedDirectory = input.workingDirectory?.trim() ?? '';
  if (trimmedDirectory.length > 0) {
    try {
      await updateProjectWorkingDirectoryAction({
        projectId: created.id,
        workingDirectory: trimmedDirectory
      });
    } catch (error) {
      // The project row is committed; reporting failure here would make the
      // UI look like nothing worked and tempt the user into a retry that
      // creates a duplicate project. Record the failure so we can still
      // triage it, and let the user set the directory from project settings.
      Sentry.captureException(
        error instanceof Error
          ? error
          : new Error(`Failed to set initial working directory: ${String(error)}`),
        { extra: { projectId: created.id, organizationId: created.organizationId } }
      );
    }
  }

  return {
    projectId: created.id,
    organizationId: created.organizationId
  };
}
