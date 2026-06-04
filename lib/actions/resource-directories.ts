'use server';

import { revalidatePath } from 'next/cache';

import {
  ensureProjectExecutionTarget,
  findExecutionTargetByFingerprint,
  upsertExecutionTargetFromProtocol
} from '@/lib/overlord/execution-targets';
import { defaultDirectoryLabel } from '@/lib/resource-directories/labels';
import {
  assertCanManagePrimary,
  clearTargetPrimary,
  shouldAutoPrimary
} from '@/lib/resource-directories/primary-resource';
import { WORKING_DIRECTORY_NONE } from '@/lib/helpers/project-working-directory';
import { createClientForRequest } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

export type ProjectResourceDirectory = {
  id: string;
  projectId: string;
  userId: string;
  deviceId: string | null;
  executionTargetId: string | null;
  deviceLabel: string | null;
  deviceHostname: string | null;
  directoryPath: string;
  label: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProjectResourceDirectoriesPayload = {
  resources: ProjectResourceDirectory[];
  /** Resolved `execution_targets.id` for this org + user + fingerprint when `deviceFingerprint` was provided. */
  matchedDeviceId: string | null;
};

type Row = Database['public']['Tables']['project_resource_directories']['Row'] & {
  execution_targets?:
    | {
        host: string | null;
        organization_execution_targets:
          | { label: string | null; organization_id: number }
          | { label: string | null; organization_id: number }[]
          | null;
      }
    | {
        host: string | null;
        organization_execution_targets:
          | { label: string | null; organization_id: number }
          | { label: string | null; organization_id: number }[]
          | null;
      }[]
    | null;
};

function rowToDto(row: Row): ProjectResourceDirectory {
  const targetRel = row.execution_targets;
  const target = Array.isArray(targetRel) ? targetRel[0] : targetRel;
  const orgRel = target?.organization_execution_targets;
  const orgTargets = Array.isArray(orgRel) ? orgRel : [orgRel];
  const orgTarget = orgTargets[0];
  const executionTargetId = row.execution_target_id ?? null;
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    deviceId: executionTargetId,
    executionTargetId,
    deviceLabel: orgTarget?.label ?? null,
    deviceHostname: target?.host ?? null,
    directoryPath: row.directory_path,
    label: row.label,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function revalidateProjectPaths(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/');
}

export type UserExecutionTarget = {
  id: string;
  label: string;
  hostname: string | null;
  platform: string | null;
  lastSeenAt: string | null;
};

export type UserExecutionTargetSshCredential = {
  username: string;
  authMethod: string;
  privateKeyPath: string | null;
  publicKeyFingerprint: string | null;
  hostKeyFingerprint: string | null;
};

export type UserExecutionTargetDetailed = UserExecutionTarget & {
  transport: string;
  port: number | null;
  isPlaceholder: boolean;
  sshCredentials: UserExecutionTargetSshCredential[];
};

/** Returns execution targets the current user has access to, enriched with transport + SSH credentials. */
export async function getUserExecutionTargetsWithDetailsAction(): Promise<
  UserExecutionTargetDetailed[]
> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await (supabase as any)
    .from('user_execution_targets')
    .select(
      'execution_target_id, execution_targets(host, port, transport, platform, last_seen_at, is_placeholder, organization_execution_targets(label, organization_id))'
    )
    .eq('user_id', user.id)
    .order('last_connected_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('getUserExecutionTargetsWithDetailsAction', error);
    return [];
  }

  const targets: UserExecutionTargetDetailed[] = (data ?? []).map((row: any) => {
    const target = Array.isArray(row.execution_targets)
      ? row.execution_targets[0]
      : row.execution_targets;
    const orgRel = target?.organization_execution_targets;
    const orgTarget = Array.isArray(orgRel) ? orgRel[0] : orgRel;
    return {
      id: row.execution_target_id as string,
      label: (orgTarget?.label ?? target?.host ?? 'Unknown target') as string,
      hostname: (target?.host ?? null) as string | null,
      platform: (target?.platform ?? null) as string | null,
      lastSeenAt: (target?.last_seen_at ?? null) as string | null,
      transport: (target?.transport ?? 'local') as string,
      port: (target?.port ?? null) as number | null,
      isPlaceholder: Boolean(target?.is_placeholder),
      sshCredentials: [] as UserExecutionTargetSshCredential[]
    };
  });

  const targetIds = targets.map(t => t.id);
  if (targetIds.length === 0) return targets;

  const { data: creds, error: credsError } = await (supabase as any)
    .from('execution_target_ssh_credentials')
    .select(
      'execution_target_id, username, auth_method, private_key_path, public_key_fingerprint, host_key_fingerprint'
    )
    .eq('user_id', user.id)
    .in('execution_target_id', targetIds);

  if (credsError) {
    console.error('getUserExecutionTargetsWithDetailsAction credentials', credsError);
    return targets;
  }

  const credsByTarget = new Map<string, UserExecutionTargetSshCredential[]>();
  for (const row of (creds ?? []) as any[]) {
    const list = credsByTarget.get(row.execution_target_id) ?? [];
    list.push({
      username: row.username,
      authMethod: row.auth_method,
      privateKeyPath: row.private_key_path,
      publicKeyFingerprint: row.public_key_fingerprint,
      hostKeyFingerprint: row.host_key_fingerprint
    });
    credsByTarget.set(row.execution_target_id, list);
  }

  for (const target of targets) {
    target.sshCredentials = credsByTarget.get(target.id) ?? [];
  }

  return targets;
}

/** Per-organization ownership status of an execution target for the current user. */
export type ExecutionTargetOrgOwnership = {
  organizationId: number;
  organizationName: string;
  /** `null` => organization-owned; otherwise the owning user's id. */
  ownerUserId: string | null;
  isOrgOwned: boolean;
  isOwnedByMe: boolean;
  /** Whether the current user is an ADMIN of this organization. */
  isAdmin: boolean;
  /** Whether the current user may claim this target as personal in this org. */
  canClaim: boolean;
  /** Whether the current user may donate this (personal) target to the org. */
  canMakeOrgOwned: boolean;
};

export type ExecutionTargetOwnership = {
  targetId: string;
  label: string;
  hostname: string | null;
  /** Org associations limited to organizations the current user belongs to. */
  organizations: ExecutionTargetOrgOwnership[];
};

/**
 * Returns the current user's execution targets with per-organization ownership
 * status, used by the settings page to claim/donate targets. Org associations
 * are limited to organizations the user is a member of; claiming requires ADMIN.
 */
export async function getExecutionTargetOwnershipsAction(): Promise<ExecutionTargetOwnership[]> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await (supabase as any)
    .from('user_execution_targets')
    .select(
      'execution_target_id, execution_targets(host, organization_execution_targets(label, organization_id, owner_user_id))'
    )
    .eq('user_id', user.id)
    .order('last_connected_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('getExecutionTargetOwnershipsAction', error);
    return [];
  }

  const rows = (data ?? []) as any[];

  const extractOrgTargets = (row: any): any[] => {
    const target = Array.isArray(row.execution_targets)
      ? row.execution_targets[0]
      : row.execution_targets;
    const orgRel = target?.organization_execution_targets;
    return Array.isArray(orgRel) ? orgRel : orgRel ? [orgRel] : [];
  };

  // Resolve the user's roles and org names in bulk across every referenced org.
  const orgIds = new Set<number>();
  for (const row of rows) {
    for (const o of extractOrgTargets(row)) {
      if (typeof o?.organization_id === 'number') orgIds.add(o.organization_id);
    }
  }

  const memberOrgIds = new Set<number>();
  const adminOrgIds = new Set<number>();
  const orgNames = new Map<number, string>();
  if (orgIds.size > 0) {
    const ids = [...orgIds];
    const [{ data: memberRows }, { data: orgRows }] = await Promise.all([
      (supabase as any)
        .from('members')
        .select('organization_id, role')
        .eq('user_id', user.id)
        .in('organization_id', ids),
      (supabase as any).from('organizations').select('id, name').in('id', ids)
    ]);
    for (const m of (memberRows ?? []) as any[]) {
      memberOrgIds.add(m.organization_id);
      if (m.role === 'ADMIN') adminOrgIds.add(m.organization_id);
    }
    for (const o of (orgRows ?? []) as any[]) orgNames.set(o.id, o.name);
  }

  return rows.map(row => {
    const target = Array.isArray(row.execution_targets)
      ? row.execution_targets[0]
      : row.execution_targets;
    const orgTargets = extractOrgTargets(row);
    const organizations: ExecutionTargetOrgOwnership[] = orgTargets
      .filter(
        (o: any) => typeof o?.organization_id === 'number' && memberOrgIds.has(o.organization_id)
      )
      .map((o: any) => {
        const ownerUserId = (o.owner_user_id ?? null) as string | null;
        const isOrgOwned = ownerUserId === null;
        const isOwnedByMe = ownerUserId === user.id;
        const isAdmin = adminOrgIds.has(o.organization_id);
        return {
          organizationId: o.organization_id as number,
          organizationName: orgNames.get(o.organization_id) ?? `Organization ${o.organization_id}`,
          ownerUserId,
          isOrgOwned,
          isOwnedByMe,
          isAdmin,
          // Claiming makes the target personal to this user; gated to admins
          // (the current owner already owns it, so claiming is a no-op for them).
          canClaim: !isOwnedByMe && isAdmin,
          // Donating to the org is allowed for the current owner or an admin, and
          // only when the target is currently personal.
          canMakeOrgOwned: !isOrgOwned && (isAdmin || isOwnedByMe)
        };
      });
    return {
      targetId: row.execution_target_id as string,
      label: (orgTargets[0]?.label ?? target?.host ?? 'Unknown target') as string,
      hostname: (target?.host ?? null) as string | null,
      organizations
    };
  });
}

/** Returns execution targets the current user has access to, for project resource assignment in the browser. */
export async function getUserExecutionTargetsAction(): Promise<UserExecutionTarget[]> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await (supabase as any)
    .from('user_execution_targets')
    .select(
      'execution_target_id, execution_targets(host, platform, last_seen_at, organization_execution_targets(label, organization_id))'
    )
    .eq('user_id', user.id)
    .order('last_connected_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('getUserExecutionTargetsAction', error);
    return [];
  }

  return (data ?? []).map((row: any) => {
    const target = Array.isArray(row.execution_targets)
      ? row.execution_targets[0]
      : row.execution_targets;
    const orgRel = target?.organization_execution_targets;
    const orgTarget = Array.isArray(orgRel) ? orgRel[0] : orgRel;
    return {
      id: row.execution_target_id,
      label: orgTarget?.label ?? target?.host ?? 'Unknown target',
      hostname: target?.host ?? null,
      platform: target?.platform ?? null,
      lastSeenAt: target?.last_seen_at ?? null
    };
  });
}

/** List resource directories for the current user on a given project. */
export async function getProjectResourceDirectoriesAction({
  projectId,
  deviceFingerprint
}: {
  projectId: string;
  /** When set (e.g. from Desktop identity), resolves the device row for this project org + user. */
  deviceFingerprint?: string | null;
}): Promise<ProjectResourceDirectoriesPayload> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { resources: [], matchedDeviceId: null };

  const fp = deviceFingerprint?.trim();
  let matchedDeviceId: string | null = null;
  if (fp) {
    const { data: project } = await supabase
      .from('projects')
      .select('organization_id')
      .eq('id', projectId)
      .maybeSingle();

    if (project) {
      matchedDeviceId = await findExecutionTargetByFingerprint(supabase, {
        organizationId: project.organization_id,
        userId: user.id,
        deviceFingerprint: fp
      });
    }
  }

  // Target-scoped listing: show every directory on the project's targets (RLS
  // limits this to org members) so the shared primary is visible regardless of
  // who added it.
  const { data, error } = await supabase
    .from('project_resource_directories')
    .select('*, execution_targets(host, organization_execution_targets(label, organization_id))')
    .eq('project_id', projectId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getProjectResourceDirectoriesAction', error);
    return { resources: [], matchedDeviceId };
  }
  const resources = (data ?? []).map(row => rowToDto(row as Row));
  return { resources, matchedDeviceId };
}

export async function addProjectResourceDirectoryAction(input: {
  projectId: string;
  directoryPath: string;
  label?: string | null;
  deviceId?: string | null;
  deviceFingerprint?: string | null;
  deviceHostname?: string | null;
  devicePlatform?: string | null;
  isPrimary?: boolean;
}): Promise<{ projectName: string; executionTargetId: string | null }> {
  const directoryPath = input.directoryPath.trim();
  if (!directoryPath) {
    throw new Error('Directory path is required.');
  }

  const supabase = await createClientForRequest();
  const serviceSupabase = createServiceRoleClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to add a resource directory.');
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('organization_id, name')
    .eq('id', input.projectId)
    .maybeSingle();
  if (projectError || !project) {
    throw new Error('Project not found.');
  }

  let resolvedExecutionTargetId: string | null = input.deviceId ?? null;
  const deviceFingerprint = input.deviceFingerprint?.trim();
  if (deviceFingerprint) {
    const upsertedId = await upsertExecutionTargetFromProtocol(serviceSupabase, {
      organizationId: project.organization_id,
      userId: user.id,
      deviceFingerprint,
      hostname: input.deviceHostname ?? null,
      platform: input.devicePlatform ?? null
    });
    if (!upsertedId) {
      throw new Error('Failed to register execution target.');
    }
    resolvedExecutionTargetId = upsertedId;
  }

  if (!resolvedExecutionTargetId) {
    throw new Error('Resource directories must be associated with an execution target.');
  }

  await ensureProjectExecutionTarget(serviceSupabase, {
    projectId: input.projectId,
    organizationId: project.organization_id,
    userId: user.id,
    executionTargetId: resolvedExecutionTargetId
  });

  await assertCanManagePrimary(serviceSupabase, {
    userId: user.id,
    projectId: input.projectId,
    executionTargetId: resolvedExecutionTargetId
  });

  const shouldSetPrimary =
    input.isPrimary ??
    (await shouldAutoPrimary(serviceSupabase, {
      projectId: input.projectId,
      executionTargetId: resolvedExecutionTargetId
    }));

  if (shouldSetPrimary) {
    await clearTargetPrimary(serviceSupabase, input.projectId, resolvedExecutionTargetId);
  }

  let label = input.label?.trim() || null;
  if (!label) {
    const { data: existingRows } = await supabase
      .from('project_resource_directories')
      .select('label')
      .eq('user_id', user.id)
      .eq('project_id', input.projectId);
    label = defaultDirectoryLabel({
      directoryPath,
      existingLabels: (existingRows ?? []).map(row => row.label)
    });
  }

  const { error } = await serviceSupabase.from('project_resource_directories').insert({
    user_id: user.id,
    project_id: input.projectId,
    execution_target_id: resolvedExecutionTargetId,
    directory_path: directoryPath,
    label,
    is_primary: shouldSetPrimary
  });

  if (error) {
    console.error('addProjectResourceDirectoryAction', error);
    // Unique violation on (project_id, execution_target_id, directory_path): the
    // folder is already linked to this project on this device. Surface a clear,
    // human-readable message instead of leaking the raw Postgres constraint text.
    if (error.code === '23505') {
      throw new Error('This folder is already linked to this project on this device.');
    }
    throw new Error(error.message ?? 'Failed to add resource directory.');
  }

  revalidateProjectPaths(input.projectId);
  return { projectName: project.name, executionTargetId: resolvedExecutionTargetId };
}

export async function removeProjectResourceDirectoryAction(input: {
  directoryId: string;
  projectId: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const serviceSupabase = createServiceRoleClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to remove a resource directory.');
  }

  const { data: existing } = await serviceSupabase
    .from('project_resource_directories')
    .select('execution_target_id, is_primary')
    .eq('id', input.directoryId)
    .eq('project_id', input.projectId)
    .maybeSingle();

  if (!existing?.execution_target_id) {
    throw new Error('Resource directory not found.');
  }

  await assertCanManagePrimary(serviceSupabase, {
    userId: user.id,
    projectId: input.projectId,
    executionTargetId: existing.execution_target_id
  });

  const { error } = await serviceSupabase
    .from('project_resource_directories')
    .delete()
    .eq('id', input.directoryId);

  if (error) {
    console.error('removeProjectResourceDirectoryAction', error);
    throw new Error(error.message ?? 'Failed to remove resource directory.');
  }

  // If we removed the primary, promote the oldest remaining directory for this
  // (project, target) so the target is never left with directories but no primary.
  if (existing.is_primary) {
    const { data: next } = await serviceSupabase
      .from('project_resource_directories')
      .select('id')
      .eq('project_id', input.projectId)
      .eq('execution_target_id', existing.execution_target_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next?.id) {
      await serviceSupabase
        .from('project_resource_directories')
        .update({ is_primary: true })
        .eq('id', next.id);
    }
  }

  revalidateProjectPaths(input.projectId);
}

export async function setResourceDirectoryPrimaryAction(input: {
  directoryId: string;
  projectId: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const serviceSupabase = createServiceRoleClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to update a resource directory.');
  }

  const { data: existing } = await serviceSupabase
    .from('project_resource_directories')
    .select('execution_target_id')
    .eq('id', input.directoryId)
    .eq('project_id', input.projectId)
    .maybeSingle();

  if (!existing?.execution_target_id) {
    throw new Error('Resource directory not found.');
  }

  await assertCanManagePrimary(serviceSupabase, {
    userId: user.id,
    projectId: input.projectId,
    executionTargetId: existing.execution_target_id
  });

  await clearTargetPrimary(serviceSupabase, input.projectId, existing.execution_target_id);

  const { error } = await serviceSupabase
    .from('project_resource_directories')
    .update({ is_primary: true })
    .eq('id', input.directoryId);

  if (error) {
    console.error('setResourceDirectoryPrimaryAction', error);
    throw new Error(error.message ?? 'Failed to set primary directory.');
  }

  revalidateProjectPaths(input.projectId);
}

/**
 * Transfer or donate target ownership. Setting `ownerUserId` to a user makes the
 * target personal to that user (in this org); setting it to `null` donates the
 * target to the organization (any project editor may then manage directories).
 * Gated to an org ADMIN or the target's current owner.
 */
export async function setExecutionTargetOwnershipAction(input: {
  targetId: string;
  organizationId: number;
  ownerUserId: string | null;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const serviceSupabase = createServiceRoleClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to change target ownership.');
  }

  const { data: existing } = await serviceSupabase
    .from('organization_execution_targets')
    .select('owner_user_id')
    .eq('organization_id', input.organizationId)
    .eq('execution_target_id', input.targetId)
    .maybeSingle();

  if (!existing) {
    throw new Error('Execution target is not associated with this organization.');
  }

  const { data: adminRow } = await serviceSupabase
    .from('members')
    .select('role')
    .eq('organization_id', input.organizationId)
    .eq('user_id', user.id)
    .eq('role', 'ADMIN')
    .limit(1);
  const isAdmin = (adminRow ?? []).length > 0;
  const isCurrentOwner = existing.owner_user_id === user.id;

  if (!isAdmin && !isCurrentOwner) {
    throw new Error('Only an organization admin or the current owner may change target ownership.');
  }

  const { error } = await serviceSupabase
    .from('organization_execution_targets')
    .update({ owner_user_id: input.ownerUserId })
    .eq('organization_id', input.organizationId)
    .eq('execution_target_id', input.targetId);

  if (error) {
    console.error('setExecutionTargetOwnershipAction', error);
    throw new Error(error.message ?? 'Failed to change target ownership.');
  }
}

/** Claim personal ownership of a target on behalf of the signed-in user. */
export async function claimExecutionTargetAction(input: {
  targetId: string;
  organizationId: number;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in to claim a target.');
  await setExecutionTargetOwnershipAction({ ...input, ownerUserId: user.id });
}

export async function updateResourceDirectoryLabelAction(input: {
  directoryId: string;
  projectId: string;
  label: string | null;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const serviceSupabase = createServiceRoleClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to update a resource directory.');
  }

  const { data: existing } = await serviceSupabase
    .from('project_resource_directories')
    .select('execution_target_id')
    .eq('id', input.directoryId)
    .eq('project_id', input.projectId)
    .maybeSingle();

  if (!existing?.execution_target_id) {
    throw new Error('Resource directory not found.');
  }

  await assertCanManagePrimary(serviceSupabase, {
    userId: user.id,
    projectId: input.projectId,
    executionTargetId: existing.execution_target_id
  });

  const trimmed = input.label?.trim();
  const { error } = await serviceSupabase
    .from('project_resource_directories')
    .update({ label: trimmed && trimmed.length > 0 ? trimmed : null })
    .eq('id', input.directoryId);

  if (error) {
    console.error('updateResourceDirectoryLabelAction', error);
    throw new Error(error.message ?? 'Failed to update resource directory label.');
  }

  revalidateProjectPaths(input.projectId);
}

export async function updateExecutionTargetLabelAction(input: {
  targetId: string;
  label: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const serviceSupabase = createServiceRoleClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to update an execution target label.');
  }

  const { data: userTarget } = await serviceSupabase
    .from('user_execution_targets')
    .select('execution_target_id')
    .eq('execution_target_id', input.targetId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!userTarget) {
    throw new Error('Execution target not found or you do not have access to it.');
  }

  const { error } = await serviceSupabase
    .from('organization_execution_targets')
    .update({ label: input.label })
    .eq('execution_target_id', input.targetId);

  if (error) {
    console.error('updateExecutionTargetLabelAction', error);
    throw new Error(error.message ?? 'Failed to update execution target label.');
  }
}

/**
 * Records that the user has explicitly opted out of setting a working directory
 * for this project on this device. Stores the sentinel value `__none__` as the
 * primary resource directory so the prompt won't show again.
 */
export async function skipProjectWorkingDirectoryAction(input: {
  projectId: string;
  deviceFingerprint: string;
  deviceHostname?: string | null;
  devicePlatform?: string | null;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const serviceSupabase = createServiceRoleClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to update a resource directory.');
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('organization_id')
    .eq('id', input.projectId)
    .maybeSingle();
  if (projectError || !project) {
    throw new Error('Project not found.');
  }

  const executionTargetId = await upsertExecutionTargetFromProtocol(serviceSupabase, {
    organizationId: project.organization_id,
    userId: user.id,
    deviceFingerprint: input.deviceFingerprint,
    hostname: input.deviceHostname ?? null,
    platform: input.devicePlatform ?? null
  });
  if (!executionTargetId) {
    throw new Error('Failed to register execution target.');
  }

  await ensureProjectExecutionTarget(serviceSupabase, {
    projectId: input.projectId,
    organizationId: project.organization_id,
    userId: user.id,
    executionTargetId
  });

  await clearTargetPrimary(serviceSupabase, input.projectId, executionTargetId);

  const { error } = await serviceSupabase.from('project_resource_directories').upsert(
    {
      user_id: user.id,
      project_id: input.projectId,
      execution_target_id: executionTargetId,
      directory_path: WORKING_DIRECTORY_NONE,
      label: null,
      is_primary: true
    },
    { onConflict: 'project_id,execution_target_id,directory_path', ignoreDuplicates: false }
  );

  if (error) {
    console.error('skipProjectWorkingDirectoryAction', error);
    throw new Error(error.message ?? 'Failed to save directory preference.');
  }

  revalidateProjectPaths(input.projectId);
}
