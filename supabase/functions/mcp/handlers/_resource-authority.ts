/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

// Deno mirror of lib/resource-directories/primary-resource.ts. Keep the two in
// sync: target-scoped primary + target-ownership write authority.

const PROJECT_EDIT_ROLES = ['ADMIN', 'MANAGER'];

/** True iff a primary directory already exists for (project, target). */
export async function targetHasPrimaryResourceDirectory(
  supabase: SupabaseClient,
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

  return ((data as any[]) ?? []).length > 0;
}

/** Whether a directory being added should auto-promote to primary. */
export async function shouldAutoPrimary(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    executionTargetId: string;
  }
): Promise<boolean> {
  return !(await targetHasPrimaryResourceDirectory(supabase, params));
}

/** Clear is_primary for all directories of (project, target). Target-scoped. */
export async function clearTargetPrimary(
  supabase: SupabaseClient,
  projectId: string,
  executionTargetId: string
): Promise<void> {
  await supabase
    .from('project_resource_directories')
    .update({ is_primary: false })
    .eq('project_id', projectId)
    .eq('execution_target_id', executionTargetId);
}

/**
 * Target-ownership write predicate:
 *   - personal target (owner set) -> only the owner may manage.
 *   - org-owned target (owner null) -> any project editor (ADMIN/MANAGER) may.
 */
export async function canManageProjectResource(
  supabase: SupabaseClient,
  params: { userId: string; projectId: string; executionTargetId: string }
): Promise<boolean> {
  const { data: project } = await supabase
    .from('projects')
    .select('organization_id')
    .eq('id', params.projectId)
    .maybeSingle();
  const organizationId = (project as any)?.organization_id ?? null;
  if (organizationId === null) return false;

  const { data: oet } = await supabase
    .from('organization_execution_targets')
    .select('owner_user_id')
    .eq('organization_id', organizationId)
    .eq('execution_target_id', params.executionTargetId)
    .maybeSingle();
  const ownerUserId = (oet as any)?.owner_user_id ?? null;

  if (ownerUserId) {
    return ownerUserId === params.userId;
  }

  const { data: member } = await supabase
    .from('members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', params.userId)
    .in('role', PROJECT_EDIT_ROLES)
    .limit(1);
  return ((member as any[]) ?? []).length > 0;
}
