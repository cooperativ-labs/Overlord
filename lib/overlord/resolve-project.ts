import type { SupabaseClient } from '@supabase/supabase-js';
import path from 'node:path';

import type { Database } from '@/types/database.types';

type ProjectRow = {
  id: string;
  name: string;
  organization_id: number;
  local_working_directory: string | null;
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
 * `local_working_directory` column of projects in the given organization.
 *
 * Matching is done after normalizing both paths (resolve, lowercase, strip
 * trailing slashes). Returns the first exact match, or null.
 */
export async function resolveProjectByWorkingDirectory(
  supabase: SupabaseClient<Database>,
  organizationId: number,
  workingDirectory: string
): Promise<ProjectRow | null> {
  const { data: projects } = await supabase
    .from('projects')
    .select('id,name,organization_id,local_working_directory')
    .eq('organization_id', organizationId)
    .not('local_working_directory', 'is', null);

  if (!projects || projects.length === 0) return null;

  const normalizedCwd = normalizeDirPath(workingDirectory);

  for (const project of projects) {
    if (!project.local_working_directory) continue;
    if (normalizeDirPath(project.local_working_directory) === normalizedCwd) {
      return project;
    }
  }

  // Fall back to checking if cwd is a subdirectory of a project directory
  for (const project of projects) {
    if (!project.local_working_directory) continue;
    const normalizedProjectDir = normalizeDirPath(project.local_working_directory);
    if (normalizedCwd.startsWith(normalizedProjectDir + '/')) {
      return project;
    }
  }

  return null;
}
