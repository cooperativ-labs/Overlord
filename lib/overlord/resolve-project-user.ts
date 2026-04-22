import type { SupabaseClient } from '@supabase/supabase-js';
import path from 'node:path';

import type { Database } from '@/types/database.types';

export type ResolvedProjectUser = {
  projectUserId: string;
  userId: string;
  projectId: string;
  organizationId: number;
  localWorkingDirectory: string | null;
};

type ProjectUserMatchRow = {
  id: string;
  user_id: string;
  project_id: string;
  local_working_directory: string | null;
  projects: { id: string; organization_id: number } | null;
};

function normalizeDirPath(dir: string): string {
  let normalized = dir.trim();
  if (normalized.startsWith('~')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    normalized = home + normalized.slice(1);
  }
  normalized = path.resolve(normalized);
  if (normalized.length > 1 && normalized.endsWith(path.sep)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

/**
 * Resolve the project_user row for the caller, given an AGENT_TOKEN (via
 * `userId`) and the working directory reported by the agent. Returns the
 * project_user id plus derived project + user identifiers.
 *
 * Matching: exact normalized match first, then parent-directory match. If the
 * user has project_user rows for multiple projects that could match, we prefer
 * the longest (most specific) match.
 */
export async function resolveProjectUserForAgent(
  supabase: SupabaseClient<Database>,
  params: { userId: string; workingDirectory: string | null | undefined }
): Promise<ResolvedProjectUser | null> {
  const { userId, workingDirectory } = params;
  if (!workingDirectory?.trim()) return null;

  const { data } = await supabase
    .from('project_user')
    .select('id, user_id, project_id, local_working_directory, projects!inner(id, organization_id)')
    .eq('user_id', userId)
    .not('local_working_directory', 'is', null);

  const rows = (data ?? []) as unknown as ProjectUserMatchRow[];
  if (rows.length === 0) return null;

  const normalizedCwd = normalizeDirPath(workingDirectory);

  let best: { row: ProjectUserMatchRow; matchLength: number } | null = null;
  for (const row of rows) {
    if (!row.local_working_directory) continue;
    const normalizedDir = normalizeDirPath(row.local_working_directory);
    const isExact = normalizedDir === normalizedCwd;
    const isParent = normalizedCwd.startsWith(normalizedDir + '/');
    if (!isExact && !isParent) continue;
    const score = normalizedDir.length + (isExact ? 1 : 0);
    if (!best || score > best.matchLength) {
      best = { row, matchLength: score };
    }
  }

  if (!best || !best.row.projects) return null;

  return {
    projectUserId: best.row.id,
    userId: best.row.user_id,
    projectId: best.row.project_id,
    organizationId: best.row.projects.organization_id,
    localWorkingDirectory: best.row.local_working_directory
  };
}

/**
 * Resolve the project_user id for a given (user, project) pair. Prefer this
 * when the project context is already known (e.g. from a ticket). Returns null
 * if the user has no project_user row for the project yet.
 */
export async function getProjectUserId(
  supabase: SupabaseClient<Database>,
  params: { userId: string; projectId: string }
): Promise<string | null> {
  const { data } = await supabase
    .from('project_user')
    .select('id')
    .eq('user_id', params.userId)
    .eq('project_id', params.projectId)
    .maybeSingle();
  return data?.id ?? null;
}
