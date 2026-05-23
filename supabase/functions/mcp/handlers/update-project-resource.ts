/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

export async function handleUpdateProjectResource(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const resourceId = typeof args?.resourceId === 'string' ? args.resourceId.trim() : '';
  const deviceFingerprint =
    typeof args?.deviceFingerprint === 'string' ? args.deviceFingerprint.trim() : '';

  if (!resourceId) return toolErr('resourceId is required.');
  if (!deviceFingerprint) return toolErr('deviceFingerprint is required.');
  if (!ctx.userId) return toolErr('Authentication required.');

  const { data: target } = await supabase
    .from('execution_targets')
    .select('id')
    .eq('device_fingerprint', deviceFingerprint)
    .maybeSingle();

  if (!target) {
    return toolErr('Execution target not found. Call get_device first to register this target.');
  }

  const { data: existing } = await supabase
    .from('project_resource_directories')
    .select('id, project_id, execution_target_id')
    .eq('id', resourceId)
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (!existing) return toolErr('Resource not found.');

  if ((existing as any).execution_target_id !== (target as any).id) {
    return toolErr('You can only update resources that belong to your current execution target.');
  }

  const directoryPath =
    typeof args?.directoryPath === 'string' ? args.directoryPath.trim() : undefined;
  const isPrimary = typeof args?.isPrimary === 'boolean' ? args.isPrimary : undefined;
  const rawLabel = args?.label;
  const label =
    rawLabel === null ? null : typeof rawLabel === 'string' ? rawLabel.trim() || null : undefined;

  if (isPrimary) {
    await supabase
      .from('project_resource_directories')
      .update({ is_primary: false })
      .eq('project_id', (existing as any).project_id)
      .eq('execution_target_id', (target as any).id)
      .neq('id', resourceId);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (directoryPath !== undefined) updates.directory_path = directoryPath;
  if (label !== undefined) updates.label = label;
  if (isPrimary !== undefined) updates.is_primary = isPrimary;

  const { data: updated, error } = await supabase
    .from('project_resource_directories')
    .update(updates)
    .eq('id', resourceId)
    .select('id, directory_path, label, is_primary, execution_target_id')
    .single();

  if (error) return toolErr(`Failed to update resource: ${error.message}`);

  return toolOk({
    resource: {
      id: (updated as any).id,
      directoryPath: (updated as any).directory_path,
      label: (updated as any).label ?? null,
      isPrimary: (updated as any).is_primary,
      deviceId: (updated as any).execution_target_id,
      executionTargetId: (updated as any).execution_target_id
    }
  });
}
