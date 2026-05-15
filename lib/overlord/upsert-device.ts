import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

export type DeviceUpsertInput = {
  organizationId: number;
  userId: string;
  deviceFingerprint: string;
  hostname?: string | null;
  platform?: string | null;
};

/**
 * Upsert a `devices` row for the calling agent. Returns the device id.
 * - First registration generates a kebab-case label via the SQL helper.
 * - Subsequent calls refresh `last_seen_at`, `hostname`, `platform`.
 */
export async function upsertDeviceFromProtocol(
  supabase: SupabaseClient<Database>,
  input: DeviceUpsertInput
): Promise<string | null> {
  const fingerprint = input.deviceFingerprint.trim();
  if (!fingerprint) return null;

  const { data: existing } = await supabase
    .from('devices')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .eq('device_fingerprint', fingerprint)
    .maybeSingle();

  const now = new Date().toISOString();
  if (existing) {
    await supabase
      .from('devices')
      .update({
        last_seen_at: now,
        ...(input.hostname ? { hostname: input.hostname } : {}),
        ...(input.platform ? { platform: input.platform } : {})
      })
      .eq('id', existing.id);
    return existing.id;
  }

  // First registration: generate label via SQL helper for org-uniqueness.
  const { data: labelRow } = await supabase.rpc('generate_device_label', {
    org_id: input.organizationId,
    hostname: input.hostname ?? '',
    platform: input.platform ?? ''
  });
  const label =
    typeof labelRow === 'string' && labelRow.length > 0 ? labelRow : `device-${fingerprint.slice(0, 8)}`;

  const { data: inserted, error } = await supabase
    .from('devices')
    .insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      device_fingerprint: fingerprint,
      label,
      hostname: input.hostname ?? null,
      platform: input.platform ?? null,
      last_seen_at: now
    })
    .select('id')
    .single();

  if (error) {
    // Race: another concurrent insert may have created it.
    const { data: retry } = await supabase
      .from('devices')
      .select('id')
      .eq('organization_id', input.organizationId)
      .eq('user_id', input.userId)
      .eq('device_fingerprint', fingerprint)
      .maybeSingle();
    return retry?.id ?? null;
  }
  return inserted?.id ?? null;
}
