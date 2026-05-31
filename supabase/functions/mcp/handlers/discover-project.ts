/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';
import path from 'node:path';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { upsertDeviceFromProtocol } from './_device-upsert.ts';

type ResourceDirectoryRow = {
  directory_path: string;
  execution_target_id: string | null;
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

function pickBestPathMatch<T>(
  rows: T[],
  normalizedCwd: string,
  getPath: (row: T) => string | null | undefined
): T | null {
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

async function resolveProjectByWorkingDirectory(
  supabase: SupabaseClient,
  organizationId: number,
  workingDirectory: string,
  userId: string | null,
  executionTargetId: string | null
) {
  const normalizedCwd = normalizeDirPath(workingDirectory);

  if (userId) {
    if (executionTargetId) {
      const { data } = await supabase
        .from('project_resource_directories')
        .select('directory_path, execution_target_id, projects!inner(id, name, organization_id)')
        .eq('user_id', userId)
        .eq('execution_target_id', executionTargetId)
        .eq('projects.organization_id', organizationId);
      const rows = (data ?? []) as unknown as ResourceDirectoryRow[];
      const match = pickBestPathMatch(rows, normalizedCwd, r => r.directory_path);
      if (match?.projects) {
        return match.projects;
      }
    }

    const { data } = await supabase
      .from('project_resource_directories')
      .select('directory_path, execution_target_id, projects!inner(id, name, organization_id)')
      .eq('user_id', userId)
      .eq('projects.organization_id', organizationId);
    const rows = (data ?? []) as unknown as ResourceDirectoryRow[];
    const match = pickBestPathMatch(rows, normalizedCwd, r => r.directory_path);
    if (match?.projects) {
      return match.projects;
    }
  }

  return null;
}

async function resolveProjectById(
  supabase: SupabaseClient,
  organizationId: number,
  projectId: string
) {
  const { data } = await supabase
    .from('projects')
    .select('id, name, organization_id')
    .eq('id', projectId)
    .eq('organization_id', organizationId)
    .single();
  return data ?? null;
}

export async function handleDiscoverProject(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  // If a projectId is explicitly provided, skip directory matching. This is the
  // preferred hosted-MCP path because hosted agents often cannot expose a useful cwd.
  const explicitProjectId = typeof args?.projectId === 'string' ? args.projectId.trim() : '';

  if (explicitProjectId) {
    const project = await resolveProjectById(supabase, ctx.organizationId, explicitProjectId);
    if (!project) {
      return toolErr('Project not found or does not belong to this organization.');
    }
    return toolOk({
      project: {
        id: project.id,
        name: project.name,
        organizationId: project.organization_id
      }
    });
  }

  const workingDirectory =
    typeof args?.workingDirectory === 'string' ? args.workingDirectory.trim() : '';
  if (!workingDirectory) {
    return toolErr('Provide either projectId or workingDirectory.');
  }

  const deviceFingerprint =
    typeof args?.deviceFingerprint === 'string' ? args.deviceFingerprint.trim() : '';
  const deviceHostname =
    typeof args?.deviceHostname === 'string' ? args.deviceHostname.trim() : null;
  const devicePlatform =
    typeof args?.devicePlatform === 'string' ? args.devicePlatform.trim() : null;

  let deviceId: string | null = null;
  if (ctx.userId && deviceFingerprint) {
    deviceId = await upsertDeviceFromProtocol(supabase, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      deviceFingerprint,
      hostname: deviceHostname,
      platform: devicePlatform
    });
  }

  const project = await resolveProjectByWorkingDirectory(
    supabase,
    ctx.organizationId,
    workingDirectory,
    ctx.userId,
    deviceId
  );

  if (!project) {
    return toolErr(
      'No project found matching this working directory. Add this directory in project settings under "Resource directories".'
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
