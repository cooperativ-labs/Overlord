import type { SupabaseClient } from '@supabase/supabase-js';
import path from 'node:path';

import type { Database } from '@/types/database.types';

type ProjectRow = {
  id: string;
  name: string;
  organization_id: number;
  local_working_directory: string | null;
};

type ResourceDirectoryJoinRow = {
  directory_path: string;
  execution_target_id: string | null;
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
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

function pickBestPathMatch<
  T extends { directory_path?: string | null; local_working_directory?: string | null }
>(rows: T[], normalizedCwd: string, getPath: (row: T) => string | null | undefined): T | null {
  const exact = rows.find(row => {
    const p = getPath(row);
    return p ? normalizeDirPath(p) === normalizedCwd : false;
  });
  if (exact) return exact;

  let best: { row: T; length: number } | null = null;
  for (const row of rows) {
    const p = getPath(row);
    if (!p) continue;
    const normalizedDir = normalizeDirPath(p);
    if (normalizedCwd.startsWith(normalizedDir + '/')) {
      if (!best || normalizedDir.length > best.length) {
        best = { row, length: normalizedDir.length };
      }
    }
  }
  return best?.row ?? null;
}

/**
 * Resolve a project by matching `workingDirectory` against, in order:
 *   1. project_resource_directories for the given execution target (if provided)
 *   2. project_resource_directories user-wide (org-checked via projects join)
 */
export async function resolveProjectByWorkingDirectory(
  supabase: SupabaseClient<Database>,
  organizationId: number,
  workingDirectory: string,
  userId?: string | null,
  executionTargetId?: string | null
): Promise<ProjectRow | null> {
  const normalizedCwd = normalizeDirPath(workingDirectory);

  // 1 + 2: project_resource_directories (device-scoped first, then user-wide).
  if (userId) {
    const baseSelect = (supabase as any)
      .from('project_resource_directories')
      .select('directory_path, execution_target_id, projects!inner(id, name, organization_id)')
      .eq('user_id', userId)
      .eq('projects.organization_id', organizationId);

    if (executionTargetId) {
      const { data } = await baseSelect.eq('execution_target_id', executionTargetId);
      const rows = (data ?? []) as unknown as ResourceDirectoryJoinRow[];
      const match = pickBestPathMatch(rows, normalizedCwd, r => r.directory_path);
      if (match?.projects) {
        return {
          id: match.projects.id,
          name: match.projects.name,
          organization_id: match.projects.organization_id,
          local_working_directory: match.directory_path
        };
      }
    }

    const { data } = await supabase
      .from('project_resource_directories')
      .select('directory_path, execution_target_id, projects!inner(id, name, organization_id)')
      .eq('user_id', userId)
      .eq('projects.organization_id', organizationId);
    const rows = (data ?? []) as unknown as ResourceDirectoryJoinRow[];
    const match = pickBestPathMatch(rows, normalizedCwd, r => r.directory_path);
    if (match?.projects) {
      return {
        id: match.projects.id,
        name: match.projects.name,
        organization_id: match.projects.organization_id,
        local_working_directory: match.directory_path
      };
    }
  }

  return null;
}
