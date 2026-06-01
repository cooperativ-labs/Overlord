import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

type ServerSupabase = SupabaseClient<Database>;

/** Org roles that may manage directories on an organization-owned target. */
export const PROJECT_EDIT_ROLES = ['ADMIN', 'MANAGER'] as const;

export type PrimaryProjectResourceDirectory = {
  projectId: string;
  executionTargetId: string;
  directoryPath: string;
};

type PrimaryResourceRow = {
  project_id: string;
  execution_target_id: string | null;
  directory_path: string;
};

function mapPrimaryRows(rows: PrimaryResourceRow[] | null | undefined) {
  const byProjectId = new Map<string, PrimaryProjectResourceDirectory>();
  for (const row of rows ?? []) {
    if (!row.execution_target_id || byProjectId.has(row.project_id)) continue;
    byProjectId.set(row.project_id, {
      projectId: row.project_id,
      executionTargetId: row.execution_target_id,
      directoryPath: row.directory_path
    });
  }
  return byProjectId;
}

/**
 * Resolve the primary resource directory per (project, target). The primary is
 * **target-scoped, not user-scoped**: on a shared target there is exactly one
 * primary per (project, target), so this intentionally does not filter by
 * `user_id` (the `user_id` column is now `added_by` audit only). Visibility for
 * request-scoped clients is governed by RLS (any org member can read).
 */
export async function getPrimaryProjectResourceDirectoriesByProjectId(
  supabase: ServerSupabase,
  params: {
    /** Accepted for call-site compatibility; no longer used to filter. */
    userId?: string | null;
    projectIds: string[];
    executionTargetId?: string | null;
  }
): Promise<Map<string, PrimaryProjectResourceDirectory>> {
  const { projectIds, executionTargetId } = params;
  if (projectIds.length === 0) return new Map();

  let query = supabase
    .from('project_resource_directories')
    .select('project_id, execution_target_id, directory_path')
    .in('project_id', projectIds)
    .eq('is_primary', true)
    .order('created_at', { ascending: true });

  if (executionTargetId) {
    query = query.eq('execution_target_id', executionTargetId);
  }

  const { data, error } = await query;
  if (error || !data) {
    if (error) console.error('getPrimaryProjectResourceDirectoriesByProjectId', error);
    return new Map();
  }

  return mapPrimaryRows(data as PrimaryResourceRow[]);
}

/**
 * True when a primary directory already exists for (project, target). Used to
 * decide auto-promotion: the first directory for a (project, target) becomes
 * primary, and a "rows exist but none primary" state self-heals (a new add
 * promotes itself). This is target-scoped, not user-scoped.
 */
export async function targetHasPrimaryResourceDirectory(
  supabase: ServerSupabase,
  params: {
    projectId: string;
    executionTargetId: string;
  }
): Promise<boolean> {
  const { data, error } = await supabase
    .from('project_resource_directories')
    .select('id')
    .eq('project_id', params.projectId)
    .eq('execution_target_id', params.executionTargetId)
    .eq('is_primary', true)
    .limit(1);

  if (error) {
    console.error('targetHasPrimaryResourceDirectory', error);
    return false;
  }

  return (data ?? []).length > 0;
}

/**
 * Whether a directory being added should auto-promote to primary: true iff there
 * is currently **no primary** for (project, target).
 */
export async function shouldAutoPrimary(
  supabase: ServerSupabase,
  params: {
    projectId: string;
    executionTargetId: string;
  }
): Promise<boolean> {
  return !(await targetHasPrimaryResourceDirectory(supabase, params));
}

async function getProjectOrganizationId(
  supabase: ServerSupabase,
  projectId: string
): Promise<number | null> {
  const { data } = await supabase
    .from('projects')
    .select('organization_id')
    .eq('id', projectId)
    .maybeSingle();
  return data?.organization_id ?? null;
}

/**
 * The per-org owner of a target (`organization_execution_targets.owner_user_id`).
 * `null` means the target is organization-owned (no single owner). Returns
 * `{ organizationId, ownerUserId }`; `organizationId` is null when the project
 * cannot be resolved.
 */
export async function resolveTargetOwnership(
  supabase: ServerSupabase,
  params: {
    projectId: string;
    executionTargetId: string;
  }
): Promise<{ organizationId: number | null; ownerUserId: string | null }> {
  const organizationId = await getProjectOrganizationId(supabase, params.projectId);
  if (organizationId === null) return { organizationId: null, ownerUserId: null };

  const { data } = await supabase
    .from('organization_execution_targets')
    .select('owner_user_id')
    .eq('organization_id', organizationId)
    .eq('execution_target_id', params.executionTargetId)
    .maybeSingle();

  return { organizationId, ownerUserId: data?.owner_user_id ?? null };
}

async function userHasProjectEditRole(
  supabase: ServerSupabase,
  organizationId: number,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .in('role', [...PROJECT_EDIT_ROLES])
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Non-throwing variant of the write-authority predicate (mirrors the
 * `can_manage_project_resource_directory` SQL helper):
 *   - personal target (owner set) -> only the owner may manage.
 *   - org-owned target (owner null) -> any project editor (ADMIN/MANAGER) may.
 */
export async function canManagePrimary(
  supabase: ServerSupabase,
  params: {
    userId: string;
    projectId: string;
    executionTargetId: string;
  }
): Promise<boolean> {
  const { organizationId, ownerUserId } = await resolveTargetOwnership(supabase, {
    projectId: params.projectId,
    executionTargetId: params.executionTargetId
  });
  if (organizationId === null) return false;

  if (ownerUserId) {
    return ownerUserId === params.userId;
  }
  return userHasProjectEditRole(supabase, organizationId, params.userId);
}

/**
 * Throwing guard for write paths. All resource-directory writes use the
 * service-role client (RLS bypassed), so this application-level check is the
 * real authorization gate (RLS is defense-in-depth).
 */
export async function assertCanManagePrimary(
  supabase: ServerSupabase,
  params: {
    userId: string;
    projectId: string;
    executionTargetId: string;
  }
): Promise<void> {
  const allowed = await canManagePrimary(supabase, params);
  if (!allowed) {
    throw new Error(
      'You do not have permission to manage resource directories for this project on this target.'
    );
  }
}

/**
 * The single canonical "clear primary" used by every write path: clears
 * `is_primary` for all directories of (project, target). Target-scoped — it does
 * NOT filter by user, since the primary is shared across users on a target.
 */
export async function clearTargetPrimary(
  supabase: ServerSupabase,
  projectId: string,
  executionTargetId: string
): Promise<void> {
  await supabase
    .from('project_resource_directories')
    .update({ is_primary: false })
    .eq('project_id', projectId)
    .eq('execution_target_id', executionTargetId);
}
