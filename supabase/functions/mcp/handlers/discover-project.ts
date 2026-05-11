/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';
import path from 'node:path';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

type ProjectUserJoinRow = {
  local_working_directory: string | null;
  projects: { id: string; name: string; organization_id: number } | null;
};

function normalizeDirPath(dir: string): string {
  let normalized = dir.trim();
  if (normalized.startsWith('~')) {
    const home = Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE') ?? '';
    normalized = home + normalized.slice(1);
  }
  normalized = path.resolve(normalized);
  if (normalized.length > 1 && (normalized.endsWith('/') || normalized.endsWith('\\'))) {
    normalized = normalized.replace(/[/\\]+$/, '');
  }
  return normalized.toLowerCase();
}

async function resolveProjectByWorkingDirectory(
  supabase: SupabaseClient,
  organizationId: number,
  workingDirectory: string,
  userId: string | null
) {
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
  if (exact?.projects) {
    return { ...exact.projects, local_working_directory: exact.local_working_directory };
  }

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

  if (best?.row.projects) {
    return {
      ...best.row.projects,
      local_working_directory: best.row.local_working_directory
    };
  }

  return null;
}

export async function handleDiscoverProject(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const workingDirectory =
    typeof args?.workingDirectory === 'string' ? args.workingDirectory.trim() : '';
  if (!workingDirectory) {
    return toolErr('workingDirectory is required.');
  }

  const project = await resolveProjectByWorkingDirectory(
    supabase,
    ctx.organizationId,
    workingDirectory,
    ctx.userId
  );

  if (!project) {
    return toolErr(
      'No project found matching this working directory. Set the local working directory in project settings.'
    );
  }

  return toolOk({
    project: {
      id: project.id,
      name: project.name,
      organizationId: project.organization_id
    }
  });
}
