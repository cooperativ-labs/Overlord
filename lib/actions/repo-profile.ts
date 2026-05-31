'use server';

import * as Sentry from '@sentry/nextjs';

import type { RepoOperationsProfile } from '@/lib/repo-profile/types';
import { getPrimaryProjectResourceDirectoriesByProjectId } from '@/lib/resource-directories/primary-resource';
import { createClientForRequest } from '@/supabase/utils/server';

export type ProjectProfileData =
  | { ok: true; localDirectory: string | null; currentFingerprint: string | null }
  | { ok: false; error: string };

export async function getProjectProfileDataAction(projectId: string): Promise<ProjectProfileData> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'Not authenticated.' };
  }

  const [projectResult, primaryResources] = await Promise.all([
    supabase.from('projects').select('operations_profile_fingerprint').eq('id', projectId).single(),
    getPrimaryProjectResourceDirectoriesByProjectId(supabase, {
      userId: user.id,
      projectIds: [projectId]
    })
  ]);

  if (projectResult.error || !projectResult.data) {
    return {
      ok: false,
      error: projectResult.error?.message ?? 'Project not found.'
    };
  }

  return {
    ok: true,
    localDirectory: primaryResources.get(projectId)?.directoryPath ?? null,
    currentFingerprint: projectResult.data.operations_profile_fingerprint ?? null
  };
}

export async function saveOperationsProfileAction(
  projectId: string,
  profile: RepoOperationsProfile,
  fingerprint: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'Not authenticated.' };
  }

  const { error } = await supabase
    .from('projects')
    .update({
      operations_profile: profile,
      operations_profile_fingerprint: fingerprint,
      operations_profile_generated_at: new Date().toISOString()
    })
    .eq('id', projectId);

  if (error) {
    Sentry.captureMessage('[saveOperationsProfile] DB update failed', {
      level: 'error',
      extra: { projectId, fingerprint, errorMessage: error.message, errorCode: error.code }
    });
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
