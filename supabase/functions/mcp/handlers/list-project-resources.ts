/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

export async function handleListProjectResources(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const projectId = typeof args?.projectId === 'string' ? args.projectId.trim() : '';
  if (!projectId) return toolErr('projectId is required.');
  if (!ctx.userId) return toolErr('Authentication required.');

  const deviceFingerprint =
    typeof args?.deviceFingerprint === 'string' ? args.deviceFingerprint.trim() : '';

  let deviceId: string | null = null;
  if (deviceFingerprint) {
    const { data: device } = await supabase
      .from('devices')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('user_id', ctx.userId)
      .eq('device_fingerprint', deviceFingerprint)
      .maybeSingle();
    deviceId = (device as any)?.id ?? null;
  }

  let query = supabase
    .from('project_resource_directories')
    .select('id, directory_path, label, is_primary, device_id, devices(label, hostname)')
    .eq('user_id', ctx.userId)
    .eq('project_id', projectId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (deviceId) {
    query = (query as any).eq('device_id', deviceId);
  }

  const { data, error } = await query;
  if (error) return toolErr(`Failed to list resources: ${error.message}`);

  const resources = (data ?? []).map((row: any) => {
    const deviceRel = row.devices;
    const device = Array.isArray(deviceRel) ? deviceRel[0] : deviceRel;
    const deviceLabel = device?.label ?? null;
    const deviceHostname = device?.hostname ?? null;
    return {
      id: row.id,
      directoryPath: row.directory_path,
      label: row.label ?? null,
      isPrimary: row.is_primary,
      deviceId: row.device_id ?? null,
      deviceLabel,
      deviceHostname
    };
  });

  return toolOk({ resources });
}
