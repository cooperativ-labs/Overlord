'use server';

import * as Sentry from '@sentry/nextjs';
import { redirect } from 'next/navigation';

import { createProject } from '@/lib/actions/projects';
import { addProjectResourceDirectoryAction } from '@/lib/actions/resource-directories';
import type { LaunchAgentType } from '@/lib/helpers/agent-types';
import { createClientForRequest } from '@/supabase/utils/server';

export type OnboardingProgress = {
  completedStep: number;
  skipped: boolean;
  preferredAgent?: LaunchAgentType;
  desktopSetupDone?: boolean;
  desktopCompletedStep?: number;
  invitedOrganizationId?: number | null;
};

export type OnboardingState = {
  userName: string | null;
  hasOrganizations: boolean;
  hasProjects: boolean;
  firstOrganizationId: number | null;
  onboardingCompletedStep: number;
  onboardingSkipped: boolean;
  preferredAgent?: LaunchAgentType;
  desktopSetupDone: boolean;
  desktopCompletedStep: number;
  invitedOrganizationId: number | null;
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
        ? (obj['preferred_agent'] as LaunchAgentType)
        : undefined,
    desktopSetupDone:
      typeof obj['desktop_setup_done'] === 'boolean' ? obj['desktop_setup_done'] : false,
    desktopCompletedStep:
      typeof obj['desktop_completed_step'] === 'number' ? obj['desktop_completed_step'] : 0,
    invitedOrganizationId:
      typeof obj['invited_organization_id'] === 'number' ? obj['invited_organization_id'] : null
  };
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const supabase = await createClientForRequest();

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
      desktopCompletedStep: progress.desktopCompletedStep ?? 0,
      invitedOrganizationId: progress.invitedOrganizationId ?? null
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
      desktopCompletedStep: progress.desktopCompletedStep ?? 0,
      invitedOrganizationId: progress.invitedOrganizationId ?? null
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
    desktopCompletedStep: progress.desktopCompletedStep ?? 0,
    invitedOrganizationId: progress.invitedOrganizationId ?? null
  };
}

export async function updateOnboardingProgressAction(update: {
  completedStep?: number;
  skipped?: boolean;
  preferredAgent?: LaunchAgentType;
  desktopSetupDone?: boolean;
  desktopCompletedStep?: number;
}): Promise<void> {
  const supabase = await createClientForRequest();
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
        : (current.desktopCompletedStep ?? 0),
    invited_organization_id: current.invitedOrganizationId ?? null
  };

  const { error } = await supabase.from('profiles').update({ onboarding: next }).eq('id', user.id);

  if (error) {
    throw new Error(error.message ?? 'Failed to update onboarding progress.');
  }
}

export async function createFirstOrganization(input: { name: string }): Promise<{
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

  const organizationId = data as number;

  return { organizationId };
}

export async function createFirstProjectWithDirectory(input: {
  organizationId: number;
  name: string;
  color: string;
  workingDirectory: string | null;
  deviceFingerprint?: string | null;
  deviceHostname?: string | null;
  devicePlatform?: string | null;
}): Promise<{
  projectId: string;
  organizationId: number;
}> {
  try {
    const created = await createProject({
      organizationId: input.organizationId,
      name: input.name,
      color: input.color
    });

    // Only persist a resource directory when the user actually picked one.
    const trimmedDirectory = input.workingDirectory?.trim() ?? '';
    if (trimmedDirectory.length > 0) {
      try {
        await addProjectResourceDirectoryAction({
          projectId: created.id,
          directoryPath: trimmedDirectory,
          isPrimary: true,
          ...(input.deviceFingerprint?.trim()
            ? {
                deviceFingerprint: input.deviceFingerprint,
                deviceHostname: input.deviceHostname ?? null,
                devicePlatform: input.devicePlatform ?? null
              }
            : {})
        });
      } catch (error) {
        // The project row is committed; reporting failure here would make the
        // UI look like nothing worked and tempt the user into a retry that
        // creates a duplicate project. Record the failure so we can still
        // triage it, and let the user set the directory from project settings.
        Sentry.captureException(
          error instanceof Error
            ? error
            : new Error(`Failed to add initial resource directory: ${String(error)}`),
          { extra: { projectId: created.id, organizationId: created.organizationId } }
        );
      }
    }

    return {
      projectId: created.id,
      organizationId: created.organizationId
    };
  } catch (error) {
    console.error('createFirstProjectWithDirectory', error);
    throw error;
  }
}
