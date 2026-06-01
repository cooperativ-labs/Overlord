'use server';

import { revalidatePath } from 'next/cache';

import { findExecutionTargetByFingerprint } from '@/lib/overlord/execution-targets';
import { DEVICE_LABEL_REGEX } from '@/lib/overlord/validation';
import { createClientForRequest } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export type UserDevice = {
  id: string;
  organizationId: number | null;
  label: string;
  hostname: string | null;
  platform: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  isAdmin: boolean;
};

export type ProjectDeviceResource = {
  id: string;
  directoryPath: string;
  label: string | null;
  isPrimary: boolean;
  createdAt: string;
};

export type ProjectDevice = {
  id: string;
  label: string;
  hostname: string | null;
  platform: string | null;
  lastSeenAt: string | null;
  resources: ProjectDeviceResource[];
  organizationId: number | null;
  /** Per-org owner of the target. `null` => organization-owned. */
  ownerUserId: string | null;
  /**
   * Whether the current user may manage this target's directories/primary
   * (owner on a personal target, or a project editor on an org-owned target).
   */
  canManage: boolean;
};

export type ProjectDevicesPayload = {
  devices: ProjectDevice[];
  matchedDeviceId: string | null;
};

export async function getUserDevicesAction(): Promise<UserDevice[]> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await (supabase as any)
    .from('user_execution_targets')
    .select(
      'execution_target_id, execution_targets(host, platform, last_seen_at, created_at, organization_execution_targets(organization_id, label))'
    )
    .eq('user_id', user.id)
    .order('last_connected_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('getUserDevicesAction', error);
    return [];
  }

  const devices = (data ?? []).map((row: any) => {
    const target = Array.isArray(row.execution_targets)
      ? row.execution_targets[0]
      : row.execution_targets;
    const orgRel = target?.organization_execution_targets;
    const orgTarget = Array.isArray(orgRel) ? orgRel[0] : orgRel;
    return {
      id: row.execution_target_id,
      organizationId: orgTarget?.organization_id ?? null,
      label: orgTarget?.label ?? target?.host ?? 'target',
      hostname: target?.host ?? null,
      platform: target?.platform ?? null,
      lastSeenAt: target?.last_seen_at ?? null,
      createdAt: target?.created_at ?? new Date(0).toISOString(),
      isAdmin: false
    };
  });

  // Check admin role for each unique organization
  const orgIds = [
    ...new Set(devices.map((d: UserDevice) => d.organizationId).filter(Boolean))
  ] as number[];
  if (orgIds.length > 0) {
    const { data: memberRows } = await (supabase as any)
      .from('members')
      .select('organization_id, role')
      .in('organization_id', orgIds)
      .eq('user_id', user.id);

    const adminOrgIds = new Set(
      (memberRows ?? []).filter((m: any) => m.role === 'ADMIN').map((m: any) => m.organization_id)
    );

    for (const device of devices) {
      if (device.organizationId && adminOrgIds.has(device.organizationId)) {
        device.isAdmin = true;
      }
    }
  }

  return devices;
}

export async function updateDeviceLabelAction(input: {
  deviceId: string;
  label: string;
}): Promise<void> {
  const label = input.label.trim();
  if (!label) {
    throw new Error('Device label is required.');
  }
  if (!DEVICE_LABEL_REGEX.test(label)) {
    throw new Error(
      'Label must be lowercase kebab-case: only lowercase letters, numbers, and hyphens are allowed (e.g., "raspberry-pi").'
    );
  }

  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to update a device.');
  }

  const { data: access } = await (supabase as any)
    .from('user_execution_targets')
    .select('execution_target_id')
    .eq('user_id', user.id)
    .eq('execution_target_id', input.deviceId)
    .maybeSingle();
  if (!access) {
    throw new Error('Execution target not found.');
  }

  const serviceSupabase = createServiceRoleClient();
  const { error } = await (serviceSupabase as any)
    .from('organization_execution_targets')
    .update({ label, updated_at: new Date().toISOString() })
    .eq('execution_target_id', input.deviceId);

  if (error) {
    if (error.code === '23505') {
      throw new Error(`The label "${label}" is already in use by another device.`);
    }
    console.error('updateDeviceLabelAction', error);
    throw new Error(error.message ?? 'Failed to update device label.');
  }

  revalidatePath('/');
}

export async function deleteOrganizationExecutionTargetAction(input: {
  organizationId: number;
  executionTargetId: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to delete a device.');
  }

  // Verify the user is an ADMIN of the organization
  const { data: member } = await (supabase as any)
    .from('members')
    .select('role')
    .eq('organization_id', input.organizationId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member || member.role !== 'ADMIN') {
    throw new Error('Only organization admins can remove execution targets.');
  }

  // Check that the target has no linked resources (project_resource_directories)
  // across any projects. RLS is not enforced here since we use service role.
  const serviceSupabase = createServiceRoleClient();
  const { count: resourceCount, error: resourceCheckError } = await (serviceSupabase as any)
    .from('project_resource_directories')
    .select('id', { count: 'exact', head: true })
    .eq('execution_target_id', input.executionTargetId);

  if (resourceCheckError) {
    console.error('deleteOrganizationExecutionTargetAction resource check', resourceCheckError);
    throw new Error('Failed to verify resource links.');
  }

  if ((resourceCount ?? 0) > 0) {
    throw new Error(
      'This target still has linked resource directories. Remove all resource directories from this target before deleting it.'
    );
  }

  // Delete the organization_execution_target; the DB trigger will auto-prune
  // the underlying execution_target if no other org references remain.
  const { error } = await (supabase as any)
    .from('organization_execution_targets')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('execution_target_id', input.executionTargetId);

  if (error) {
    console.error('deleteOrganizationExecutionTargetAction', error);
    throw new Error(error.message ?? 'Failed to remove execution target.');
  }

  revalidatePath('/');
}

export async function getProjectDevicesAction({
  projectId,
  deviceFingerprint
}: {
  projectId: string;
  deviceFingerprint?: string | null;
}): Promise<ProjectDevicesPayload> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { devices: [], matchedDeviceId: null };

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

  const { data: deviceRows, error: devErr } = await (supabase as any)
    .from('project_execution_targets')
    .select(
      'execution_target_id, organization_id, execution_targets(host, platform, last_seen_at, organization_execution_targets(label, organization_id, owner_user_id))'
    )
    .eq('project_id', projectId);

  if (devErr) {
    console.error('getProjectDevicesAction devices', devErr);
    return { devices: [], matchedDeviceId };
  }

  // Resolve whether the current user is a project editor (ADMIN/MANAGER) in the
  // project's org, to decide manage permission on org-owned targets.
  const { data: projectRow } = await supabase
    .from('projects')
    .select('organization_id')
    .eq('id', projectId)
    .maybeSingle();
  let userIsProjectEditor = false;
  if (projectRow?.organization_id) {
    const { data: roleRows } = await supabase
      .from('members')
      .select('role')
      .eq('organization_id', projectRow.organization_id)
      .eq('user_id', user.id)
      .in('role', ['ADMIN', 'MANAGER'])
      .limit(1);
    userIsProjectEditor = (roleRows ?? []).length > 0;
  }

  // Directories are target-scoped, not per-user: list every directory on the
  // project's targets (RLS still limits visibility to org members) so the shared
  // primary is shown regardless of who added it.
  const { data: resourceRows, error: resErr } = await supabase
    .from('project_resource_directories')
    .select('id, execution_target_id, directory_path, label, is_primary, created_at')
    .eq('project_id', projectId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (resErr) {
    console.error('getProjectDevicesAction resources', resErr);
    return { devices: [], matchedDeviceId };
  }

  const resourcesByTarget = new Map<string, ProjectDeviceResource[]>();
  for (const row of resourceRows ?? []) {
    const targetId = row.execution_target_id;
    if (!targetId) continue;
    const arr = resourcesByTarget.get(targetId) ?? [];
    arr.push({
      id: row.id,
      directoryPath: row.directory_path,
      label: row.label,
      isPrimary: row.is_primary,
      createdAt: row.created_at
    });
    resourcesByTarget.set(targetId, arr);
  }

  const devices: ProjectDevice[] = (deviceRows ?? []).map((row: any) => {
    const target = Array.isArray(row.execution_targets)
      ? row.execution_targets[0]
      : row.execution_targets;
    const orgRel = target?.organization_execution_targets;
    const orgTargets = Array.isArray(orgRel) ? orgRel : orgRel ? [orgRel] : [];
    // Pick the association for this project's org (a target may be shared across orgs).
    const orgTarget =
      orgTargets.find((o: any) => o?.organization_id === row.organization_id) ?? orgTargets[0];
    const id = row.execution_target_id;
    const ownerUserId = orgTarget?.owner_user_id ?? null;
    const canManage = ownerUserId ? ownerUserId === user.id : userIsProjectEditor;
    return {
      id,
      label: orgTarget?.label ?? target?.host ?? 'Unknown device',
      hostname: target?.host ?? null,
      platform: target?.platform ?? null,
      lastSeenAt: target?.last_seen_at ?? null,
      resources: resourcesByTarget.get(id) ?? [],
      organizationId: row.organization_id ?? null,
      ownerUserId,
      canManage
    };
  });

  return { devices, matchedDeviceId };
}
