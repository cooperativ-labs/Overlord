'use server';

import { revalidatePath } from 'next/cache';

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
