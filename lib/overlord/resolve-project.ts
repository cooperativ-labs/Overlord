import type { SupabaseClient } from '@supabase/supabase-js';
import path from 'node:path';

import type { Database } from '@/types/database.types';

type ProjectRow = {
  id: string;
  name: string;
  organization_id: number;
  local_working_directory: string | null;
};

type ProjectUserJoinRow = {
  local_working_directory: string | null;
  projects: { id: string; name: string; organization_id: number } | null;
};

/**
 * Normalize a directory path for comparison: resolve, lowercase, strip trailing
 * slashes, and expand `~` to $HOME if present.
 */
function normalizeDirPath(dir: string): string {
  let normalized = dir.trim();
  if (normalized.startsWith('~')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    normalized = home + normalized.slice(1);
  }
  normalized = path.resolve(normalized);
  // Strip trailing slash (but keep root '/')
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

/**
 * Resolve a project by matching `workingDirectory` against the
 * `local_working_directory` column of project_user rows in the given
 * organization.
 *
 * Matching is done after normalizing both paths (resolve, lowercase, strip
 * trailing slashes). Returns the first exact match, or null.
 *
 * When `userId` is provided, matching is restricted to project_user rows
 * belonging to that user — this is what agent-token flows want, because the
 * same repo path can legitimately map to different projects for different
 * teammates. When omitted, all project_user rows for the org are considered
 * (used by the UI).
 */
export async function resolveProjectByWorkingDirectory(
  supabase: SupabaseClient<Database>,
  organizationId: number,
  workingDirectory: string,
  userId?: string | null
): Promise<ProjectRow | null> {
  let query = supabase
    .from('project_user')
    .select('local_working_directory, projects!inner(id, name, organization_id)')
    .eq('projects.organization_id', organizationId)
    .not('local_working_directory', 'is', null);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data } = await query;

  const rows = (data ?? []) as unknown as ProjectUserJoinRow[];
  if (rows.length === 0) return null;

  const normalizedCwd = normalizeDirPath(workingDirectory);

  const exact = rows.find(
    row =>
      row.local_working_directory && normalizeDirPath(row.local_working_directory) === normalizedCwd
  );
  if (exact && exact.projects) {
    return { ...exact.projects, local_working_directory: exact.local_working_directory };
  }

  // Fall back to the most specific parent-directory match.
  let best: { row: ProjectUserJoinRow; length: number } | null = null;
  for (const row of rows) {
    if (!row.local_working_directory) continue;
    const normalizedProjectDir = normalizeDirPath(row.local_working_directory);
    if (normalizedCwd.startsWith(normalizedProjectDir + '/')) {
      if (!best || normalizedProjectDir.length > best.length) {
        best = { row, length: normalizedProjectDir.length };
      }
    }
  }

  if (best && best.row.projects) {
    return {
      ...best.row.projects,
      local_working_directory: best.row.local_working_directory
    };
  }

  return null;
}
