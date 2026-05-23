/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

export async function handleUpdateDevice(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const deviceFingerprint =
    typeof args?.deviceFingerprint === 'string' ? args.deviceFingerprint.trim() : '';
  const label = typeof args?.label === 'string' ? args.label.trim() : '';

  if (!deviceFingerprint) return toolErr('deviceFingerprint is required.');
  if (!label) return toolErr('label is required.');
  if (!ctx.userId) return toolErr('Authentication required.');

  const { data: existing } = await supabase
    .from('execution_targets')
    .select('id')
    .eq('device_fingerprint', deviceFingerprint)
    .maybeSingle();

  if (!existing) {
    return toolErr('Device not found. Call get_device first to register this device.');
  }

  const { data: updated, error } = await supabase
    .from('organization_execution_targets')
    .update({ label, updated_at: new Date().toISOString() })
    .eq('organization_id', ctx.organizationId)
    .eq('execution_target_id', (existing as any).id)
    .select('execution_target_id, label, execution_targets(host, platform)')
    .single();

  if (error) {
    if (error.code === '23505') {
      return toolErr(
        `The label "${label}" is already in use by another device in this organization.`
      );
    }
    if (error.code === '23514') {
      return toolErr(
        'Invalid device label: use lowercase kebab-case only (letters, numbers, hyphens; 1–64 characters).'
      );
    }
    return toolErr(`Failed to update device label: ${error.message}`);
  }

  const targetRel = (updated as any).execution_targets;
  const target = Array.isArray(targetRel) ? targetRel[0] : targetRel;

  return toolOk({
    device: {
      id: (updated as any).execution_target_id,
      executionTargetId: (updated as any).execution_target_id,
      label: (updated as any).label,
      hostname: target?.host ?? null,
      platform: target?.platform ?? null
    }
  });
}
