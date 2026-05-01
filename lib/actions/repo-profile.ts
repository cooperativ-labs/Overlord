'use server';

import fs from 'node:fs/promises';

import * as Sentry from '@sentry/nextjs';

import { getServerActionRequestDiagnostics } from '@/lib/diagnostics/server-action';
import { resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { buildRepoOperationsProfile } from '@/lib/repo-profile/build-profile';
import type { RepoOperationsProfile } from '@/lib/repo-profile/types';
import { createClientForRequest } from '@/supabase/utils/server';

const LOG_PREFIX = '[rebuildOperationsProfile]';
const SENTRY_TAG_FEATURE = 'rebuild_operations_profile';

function serializeForSentry(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toBreadcrumbData(details?: Record<string, unknown>): Record<string, string | number | boolean | null> {
  if (!details || Object.keys(details).length === 0) {
    return {};
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(details)) {
    out[k] = serializeForSentry(v);
  }
  return out;
}

function toSentryExtra(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details || Object.keys(details).length === 0) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    out[k] = serializeForSentry(v);
  }
  return out;
}

function logStep(message: string, details?: Record<string, unknown>) {
  if (details && Object.keys(details).length > 0) {
    console.log(LOG_PREFIX, message, details);
  } else {
    console.log(LOG_PREFIX, message);
  }
  Sentry.addBreadcrumb({
    category: SENTRY_TAG_FEATURE,
    level: 'info',
    message: `${LOG_PREFIX} ${message}`,
    data: toBreadcrumbData(details)
  });
}

function sentryReportProfileFailure({
  userVisibleError,
  extra
}: {
  userVisibleError: string;
  extra?: Record<string, unknown>;
}) {
  Sentry.captureMessage(`${LOG_PREFIX} ${userVisibleError}`, {
    level: 'warning',
    tags: { feature: SENTRY_TAG_FEATURE },
    extra: toSentryExtra({ userVisibleError, ...extra })
  });
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
    sentryReportProfileFailure({
      userVisibleError: 'Building the operations profile requires the Overlord desktop app.',
      extra: { projectId, reason: 'not_electron', diagnostics }
    });
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
    sentryReportProfileFailure({
      userVisibleError: 'Not authenticated.',
      extra: { projectId, reason: 'not_authenticated' }
    });
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
    const msg = projectError?.message ?? 'Project not found.';
    sentryReportProfileFailure({
      userVisibleError: msg,
      extra: {
        projectId,
        reason: 'project_fetch',
        projectErrorCode: projectError?.code ?? null,
        projectErrorMessage: projectError?.message ?? null
      }
    });
    return { ok: false, error: msg };
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
    sentryReportProfileFailure({
      userVisibleError: 'No linked working directory for this project.',
      extra: {
        projectId,
        reason: 'no_linked_root',
        rawLocalWorkingDirectory: projectUser?.local_working_directory ?? null
      }
    });
    return { ok: false, error: 'No linked working directory for this project.' };
  }

  let statError: string | null = null;
  const stat = await fs.stat(root).catch((err: unknown) => {
    statError = err instanceof Error ? err.message : String(err);
    logStep('fs.stat threw', { root, statError });
    if (err instanceof Error) {
      Sentry.captureException(err, {
        tags: { feature: SENTRY_TAG_FEATURE },
        extra: toSentryExtra({ projectId, root, phase: 'fs.stat' })
      });
    } else {
      Sentry.captureMessage(`${LOG_PREFIX} fs.stat failed: ${statError}`, {
        level: 'warning',
        tags: { feature: SENTRY_TAG_FEATURE },
        extra: toSentryExtra({ projectId, root, phase: 'fs.stat' })
      });
    }
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
    sentryReportProfileFailure({
      userVisibleError: 'Linked working directory is missing or not a directory.',
      extra: {
        projectId,
        reason: 'root_not_directory',
        root,
        statError
      }
    });
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
    if (err instanceof Error) {
      Sentry.captureException(err, {
        tags: { feature: SENTRY_TAG_FEATURE },
        extra: toSentryExtra({ projectId, root, phase: 'buildRepoOperationsProfile' })
      });
    } else {
      Sentry.captureMessage(`${LOG_PREFIX} buildRepoOperationsProfile failed: ${buildError}`, {
        level: 'error',
        tags: { feature: SENTRY_TAG_FEATURE },
        extra: toSentryExtra({ projectId, root, phase: 'buildRepoOperationsProfile' })
      });
    }
    return null;
  });

  if (!buildResult) {
    logStep('abort: profile build failed');
    const msg = buildError ?? 'Failed to build operations profile.';
    return { ok: false, error: msg };
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
    logStep('skip DB update (fingerprint unchanged)', { projectId, fingerprint });
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
    sentryReportProfileFailure({
      userVisibleError: updateError.message,
      extra: {
        projectId,
        reason: 'projects_update',
        fingerprint,
        updateErrorCode: updateError.code ?? null,
        updateErrorDetails: updateError.details ?? null,
        updateErrorHint: updateError.hint ?? null
      }
    });
    return { ok: false, error: updateError.message };
  }

  logStep('success', { rebuilt: true, fingerprint, projectId });
  return { ok: true, rebuilt: true, fingerprint, profile };
}
