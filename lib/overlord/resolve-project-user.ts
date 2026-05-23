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

type ResourceDirectoryMatchRow = {
  directory_path: string;
  execution_target_id: string | null;
  project_id: string;
  user_id: string;
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

function scorePathMatch(normalizedDir: string, normalizedCwd: string): number | null {
  if (normalizedDir === normalizedCwd) return normalizedDir.length + 1;
  if (normalizedCwd.startsWith(normalizedDir + '/')) return normalizedDir.length;
  return null;
}

/**
 * Resolve the project_user row for the caller, given the authenticated
 * `userId` and the working directory reported by the agent.
 *
 * Looks at project_resource_directories (preferring rows with a matching
 * execution_target_id, then any user-scoped row). Once a project is matched,
 * the project_user row for (userId, projectId) is returned.
 */
export async function resolveProjectUserForAgent(
  supabase: SupabaseClient<Database>,
  params: {
    userId: string;
    workingDirectory: string | null | undefined;
    deviceId?: string | null;
  }
): Promise<ResolvedProjectUser | null> {
  const { userId, workingDirectory, deviceId } = params;
  if (!workingDirectory?.trim()) return null;

  const normalizedCwd = normalizeDirPath(workingDirectory);

  // 1. project_resource_directories — prefer device-scoped rows when matching.
  const { data: resourceRows } = await (supabase as any)
    .from('project_resource_directories')
    .select(
      'directory_path, execution_target_id, project_id, user_id, projects!inner(id, organization_id)'
    )
    .eq('user_id', userId);

  const resources = (resourceRows ?? []) as unknown as ResourceDirectoryMatchRow[];
  if (resources.length > 0) {
    let best: { row: ResourceDirectoryMatchRow; score: number; deviceBoost: number } | null = null;
    for (const row of resources) {
      const score = scorePathMatch(normalizeDirPath(row.directory_path), normalizedCwd);
      if (score === null) continue;
      const deviceBoost = deviceId && row.execution_target_id === deviceId ? 1 : 0;
      if (
        !best ||
        deviceBoost > best.deviceBoost ||
        (deviceBoost === best.deviceBoost && score > best.score)
      ) {
        best = { row, score, deviceBoost };
      }
    }
    if (best?.row.projects) {
      // Look up the project_user row for (userId, projectId).
      const { data: pu } = await supabase
        .from('project_user')
        .select('id, local_working_directory')
        .eq('user_id', userId)
        .eq('project_id', best.row.project_id)
        .maybeSingle();
      if (pu) {
        return {
          projectUserId: pu.id,
          userId,
          projectId: best.row.project_id,
          organizationId: best.row.projects.organization_id,
          localWorkingDirectory: pu.local_working_directory ?? best.row.directory_path
        };
      }
    }
  }

  return null;
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
