'use server';

import fs from 'node:fs/promises';

import { getServerActionRequestDiagnostics } from '@/lib/diagnostics/server-action';
import { resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { buildRepoOperationsProfile } from '@/lib/repo-profile/build-profile';
import type { RepoOperationsProfile } from '@/lib/repo-profile/types';
import { createClientForRequest } from '@/supabase/utils/server';

const LOG_PREFIX = '[rebuildOperationsProfile]';

function logStep(message: string, details?: Record<string, unknown>) {
  if (details && Object.keys(details).length > 0) {
    console.log(LOG_PREFIX, message, details);
  } else {
    console.log(LOG_PREFIX, message);
  }
}

export type RebuildResult =
  | { ok: true; rebuilt: boolean; fingerprint: string; profile: RepoOperationsProfile }
  | { ok: false; error: string };

export async function rebuildOperationsProfileAction(
  projectId: string,
  options: { force?: boolean } = {}
): Promise<RebuildResult> {
  logStep('start', {
    projectId,
    force: Boolean(options.force)
  });

  const diagnostics = await getServerActionRequestDiagnostics();
  logStep('diagnostics', {
    isElectron: diagnostics.isElectron,
    keys: Object.keys(diagnostics)
  });

  if (!diagnostics.isElectron) {
    logStep('abort: not Electron');
    return {
      ok: false,
      error: 'Building the operations profile requires the Overlord desktop app.'
    };
  }

  const supabase = await createClientForRequest();
  logStep('supabase client created');

  const {
    data: { user }
  } = await supabase.auth.getUser();
  logStep('auth.getUser', { hasUser: Boolean(user), userId: user?.id ?? null });

  if (!user) {
    logStep('abort: not authenticated');
    return { ok: false, error: 'Not authenticated.' };
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, operations_profile_fingerprint')
    .eq('id', projectId)
    .single();

  logStep('projects.select', {
    hasProject: Boolean(project),
    projectError: projectError?.message ?? null,
    projectErrorCode: projectError?.code ?? null,
    storedFingerprint: project?.operations_profile_fingerprint ?? null
  });

  if (projectError || !project) {
    logStep('abort: project fetch failed');
    return { ok: false, error: projectError?.message ?? 'Project not found.' };
  }

  const { data: projectUser, error: projectUserError } = await supabase
    .from('project_user')
    .select('local_working_directory')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .maybeSingle();

  logStep('project_user.select', {
    hasRow: Boolean(projectUser),
    projectUserError: projectUserError?.message ?? null,
    rawLocalWorkingDirectory: projectUser?.local_working_directory ?? null
  });

  const root = resolveLinkedDirectory(projectUser?.local_working_directory ?? null);
  logStep('resolveLinkedDirectory', { root });

  if (!root) {
    logStep('abort: no linked root');
    return { ok: false, error: 'No linked working directory for this project.' };
  }

  let statError: string | null = null;
  const stat = await fs.stat(root).catch((err: unknown) => {
    statError = err instanceof Error ? err.message : String(err);
    logStep('fs.stat threw', { root, statError });
    return null;
  });

  logStep('fs.stat', {
    root,
    exists: Boolean(stat),
    isDirectory: stat?.isDirectory() ?? false,
    statError
  });

  if (!stat?.isDirectory()) {
    logStep('abort: root missing or not directory');
    return { ok: false, error: 'Linked working directory is missing or not a directory.' };
  }

  logStep('buildRepoOperationsProfile: begin', { root });
  let buildError: string | null = null;
  const buildResult = await buildRepoOperationsProfile(root).catch((err: unknown) => {
    buildError = err instanceof Error ? err.message : String(err);
    logStep('buildRepoOperationsProfile threw', {
      root,
      buildError,
      stack: err instanceof Error ? err.stack : null
    });
    return null;
  });

  if (!buildResult) {
    logStep('abort: profile build failed');
    return { ok: false, error: buildError ?? 'Failed to build operations profile.' };
  }

  const { profile, fingerprint } = buildResult;
  logStep('buildRepoOperationsProfile: done', {
    fingerprint,
    workspaceCount: profile.workspaces.length,
    deployableCount: profile.deployables.length,
    hasMigrations: Boolean(profile.migrations),
    codegenSteps: profile.codegen.length,
    hasTests: Boolean(profile.tests),
    manifestCount: profile.manifests.length,
    scriptWorkspaceKeys: Object.keys(profile.scripts_by_workspace).length
  });

  if (!options.force && project.operations_profile_fingerprint === fingerprint) {
    logStep('skip DB update (fingerprint unchanged)', { fingerprint });
    return { ok: true, rebuilt: false, fingerprint, profile };
  }

  logStep('projects.update: begin', {
    fingerprint,
    force: Boolean(options.force),
    previousFingerprint: project.operations_profile_fingerprint
  });

  const { error: updateError } = await supabase
    .from('projects')
    .update({
      operations_profile: profile,
      operations_profile_fingerprint: fingerprint,
      operations_profile_generated_at: new Date().toISOString()
    })
    .eq('id', projectId);

  logStep('projects.update: result', {
    updateError: updateError?.message ?? null,
    updateErrorCode: updateError?.code ?? null,
    updateErrorDetails: updateError?.details ?? null,
    updateErrorHint: updateError?.hint ?? null
  });

  if (updateError) {
    logStep('abort: DB update failed');
    return { ok: false, error: updateError.message };
  }

  logStep('success', { rebuilt: true, fingerprint });
  return { ok: true, rebuilt: true, fingerprint, profile };
}
