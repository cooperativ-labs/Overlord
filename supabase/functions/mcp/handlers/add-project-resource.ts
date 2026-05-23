/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { upsertDeviceFromProtocol } from './_device-upsert.ts';

export async function handleAddProjectResource(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const projectId = typeof args?.projectId === 'string' ? args.projectId.trim() : '';
  const directoryPath = typeof args?.directoryPath === 'string' ? args.directoryPath.trim() : '';
  const deviceFingerprint =
    typeof args?.deviceFingerprint === 'string' ? args.deviceFingerprint.trim() : '';

  if (!projectId) return toolErr('projectId is required.');
  if (!directoryPath) return toolErr('directoryPath is required.');
  if (!deviceFingerprint) return toolErr('deviceFingerprint is required.');
  if (!ctx.userId) return toolErr('Authentication required.');

  const label = typeof args?.label === 'string' ? args.label.trim() || null : null;
  const isPrimary = args?.isPrimary === true;
  const deviceHostname =
    typeof args?.deviceHostname === 'string' ? args.deviceHostname.trim() : null;
  const devicePlatform =
    typeof args?.devicePlatform === 'string' ? args.devicePlatform.trim() : null;

  // Verify project belongs to the organization
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  if (!project) return toolErr('Project not found.');

  const deviceId = await upsertDeviceFromProtocol(supabase, {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    deviceFingerprint,
    hostname: deviceHostname,
    platform: devicePlatform
  });

  if (!deviceId) return toolErr('Failed to register device.');

  if (isPrimary) {
    // A device has at most one primary resource — clear by device, not project.
    await supabase
      .from('project_resource_directories')
      .update({ is_primary: false })
      .eq('user_id', ctx.userId)
      .eq('device_id', deviceId);
  }

  const { data: inserted, error } = await supabase
    .from('project_resource_directories')
    .insert({
      user_id: ctx.userId,
      project_id: projectId,
      device_id: deviceId,
      directory_path: directoryPath,
      label,
      is_primary: isPrimary
    })
    .select('id, directory_path, label, is_primary, device_id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return toolErr('This directory is already registered for this project on this device.');
    }
    return toolErr(`Failed to add resource: ${error.message}`);
  }

  return toolOk({
    resource: {
      id: (inserted as any).id,
      directoryPath: (inserted as any).directory_path,
      label: (inserted as any).label ?? null,
      isPrimary: (inserted as any).is_primary,
      deviceId: (inserted as any).device_id
    }
  });
}
