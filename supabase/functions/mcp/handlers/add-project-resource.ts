/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { upsertDeviceFromProtocol } from './_device-upsert.ts';
import {
  canManageProjectResource,
  clearTargetPrimary,
  shouldAutoPrimary
} from './_resource-authority.ts';

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
  const explicitPrimary = typeof args?.isPrimary === 'boolean' ? args.isPrimary : undefined;
  const deviceHostname =
    typeof args?.deviceHostname === 'string' ? args.deviceHostname.trim() : null;
  const devicePlatform =
    typeof args?.devicePlatform === 'string' ? args.devicePlatform.trim() : null;
  const devicePort =
    typeof args?.devicePort === 'number' && Number.isFinite(args.devicePort)
      ? args.devicePort
      : null;

  // Verify project belongs to the organization
  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id')
    .eq('id', projectId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  if (!project) return toolErr('Project not found.');

  const executionTargetId = await upsertDeviceFromProtocol(supabase, {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    deviceFingerprint,
    hostname: deviceHostname,
    port: devicePort,
    platform: devicePlatform
  });

  if (!executionTargetId) return toolErr('Failed to register execution target.');

  await supabase.from('project_execution_targets').upsert(
    {
      project_id: projectId,
      execution_target_id: executionTargetId,
      organization_id: ctx.organizationId,
      added_by: ctx.userId
    },
    { onConflict: 'project_id,execution_target_id' }
  );

  const canManage = await canManageProjectResource(supabase, {
    userId: ctx.userId,
    projectId,
    executionTargetId
  });
  if (!canManage) {
    return toolErr(
      'You do not have permission to manage resource directories for this project on this target.'
    );
  }

  // Auto-promote the first directory (no primary yet) on this (project, target),
  // matching the server-action and REST add paths.
  const isPrimary =
    explicitPrimary ?? (await shouldAutoPrimary(supabase, { projectId, executionTargetId }));

  if (isPrimary) {
    await clearTargetPrimary(supabase, projectId, executionTargetId);
  }

  const { data: inserted, error } = await supabase
    .from('project_resource_directories')
    .insert({
      user_id: ctx.userId,
      project_id: projectId,
      execution_target_id: executionTargetId,
      directory_path: directoryPath,
      label,
      is_primary: isPrimary
    })
    .select('id, directory_path, label, is_primary, execution_target_id')
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
      deviceId: (inserted as any).execution_target_id,
      executionTargetId: (inserted as any).execution_target_id
    }
  });
}
