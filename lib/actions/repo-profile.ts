'use server';

import fs from 'node:fs/promises';

import { resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { buildRepoOperationsProfile } from '@/lib/repo-profile/build-profile';
import type { RepoOperationsProfile } from '@/lib/repo-profile/types';
import { createClientForRequest } from '@/supabase/utils/server';

export type RebuildResult =
  | { ok: true; rebuilt: boolean; fingerprint: string; profile: RepoOperationsProfile }
  | { ok: false; error: string };

export async function rebuildOperationsProfileAction(
  projectId: string,
  options: { force?: boolean } = {}
): Promise<RebuildResult> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'Not authenticated.' };
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, operations_profile_fingerprint')
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    return { ok: false, error: projectError?.message ?? 'Project not found.' };
  }

  const { data: projectUser } = await supabase
    .from('project_user')
    .select('local_working_directory')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .maybeSingle();

  const root = resolveLinkedDirectory(projectUser?.local_working_directory ?? null);
  if (!root) {
    return { ok: false, error: 'No linked working directory for this project.' };
  }

  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) {
    return { ok: false, error: 'Linked working directory is missing or not a directory.' };
  }

  const { profile, fingerprint } = await buildRepoOperationsProfile(root);

  if (!options.force && project.operations_profile_fingerprint === fingerprint) {
    return { ok: true, rebuilt: false, fingerprint, profile };
  }

  const { error: updateError } = await supabase
    .from('projects')
    .update({
      operations_profile: profile,
      operations_profile_fingerprint: fingerprint,
      operations_profile_generated_at: new Date().toISOString()
    })
    .eq('id', projectId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true, rebuilt: true, fingerprint, profile };
}
