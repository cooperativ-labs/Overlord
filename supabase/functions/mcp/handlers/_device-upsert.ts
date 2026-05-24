/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

export type DeviceUpsertInput = {
  organizationId: number;
  userId: string;
  deviceFingerprint: string;
  hostname?: string | null;
  port?: number | null;
  platform?: string | null;
};

function normalizePort(port: number | null | undefined): number {
  return typeof port === 'number' && Number.isFinite(port) ? port : 22;
}

async function findSshPlaceholderId(
  supabase: SupabaseClient,
  input: { host: string; port?: number | null }
): Promise<string | null> {
  const host = input.host.trim();
  if (!host) return null;

  const baseQuery = () =>
    supabase
      .from('execution_targets')
      .select('id')
      .eq('is_placeholder', true)
      .eq('host', host)
      .eq('transport', 'ssh');

  if (typeof input.port === 'number') {
    const { data } = await baseQuery().eq('port', normalizePort(input.port)).maybeSingle();
    return (data as any)?.id ?? null;
  }

  const { data: matches } = await baseQuery();
  if (!matches || matches.length !== 1) return null;
  return (matches[0] as any)?.id ?? null;
}

async function generateLabel(
  supabase: SupabaseClient,
  organizationId: number,
  hostname: string | null | undefined,
  platform: string | null | undefined
): Promise<string> {
  const { data } = await supabase.rpc('generate_execution_target_label', {
    org_id: organizationId,
    hostname: hostname ?? '',
    platform: platform ?? ''
  });
  return typeof data === 'string' && data.length > 0 ? data : 'target';
}

/** Upsert a canonical execution target for the protocol caller and return its id. */
export async function upsertDeviceFromProtocol(
  supabase: SupabaseClient,
  input: DeviceUpsertInput
): Promise<string | null> {
  const fingerprint = input.deviceFingerprint?.trim();
  if (!fingerprint) return null;

  const { data: existing } = await supabase
    .from('execution_targets')
    .select('id')
    .eq('device_fingerprint', fingerprint)
    .maybeSingle();

  const now = new Date().toISOString();
  if (existing) {
    await supabase
      .from('execution_targets')
      .update({
        host: input.hostname ?? '',
        last_seen_at: now,
        platform: input.platform ?? null,
        transport: input.platform === 'ssh' ? 'ssh' : 'local',
        is_placeholder: false,
        placeholder_key: null
      })
      .eq('id', (existing as any).id);
    await ensureAssociations(supabase, {
      organizationId: input.organizationId,
      userId: input.userId,
      executionTargetId: (existing as any).id,
      defaultUsername: null
    });
    return (existing as any).id;
  }

  const host = input.hostname ?? '';
  const placeholderId = host
    ? await findSshPlaceholderId(supabase, { host, port: input.port })
    : null;

  if (placeholderId) {
    const targetId = placeholderId;
    await supabase
      .from('execution_targets')
      .update({
        device_fingerprint: fingerprint,
        is_placeholder: false,
        placeholder_key: null,
        host,
        platform: input.platform ?? null,
        transport: input.platform === 'ssh' ? 'ssh' : 'local',
        last_seen_at: now
      })
      .eq('id', targetId);
    await ensureAssociations(supabase, {
      organizationId: input.organizationId,
      userId: input.userId,
      executionTargetId: targetId,
      defaultUsername: null
    });
    return targetId;
  }

  const label = await generateLabel(supabase, input.organizationId, input.hostname, input.platform);

  const { data: inserted, error } = await supabase
    .from('execution_targets')
    .insert({
      device_fingerprint: fingerprint,
      host: input.hostname ?? '',
      port: 22,
      name: label,
      transport: input.platform === 'ssh' ? 'ssh' : 'local',
      platform: input.platform ?? null,
      last_seen_at: now
    })
    .select('id')
    .single();
  if (error) {
    const { data: retry } = await supabase
      .from('execution_targets')
      .select('id')
      .eq('device_fingerprint', fingerprint)
      .maybeSingle();
    if (!(retry as any)?.id) return null;
    await ensureAssociations(supabase, {
      organizationId: input.organizationId,
      userId: input.userId,
      executionTargetId: (retry as any).id,
      defaultUsername: null
    });
    return (retry as any).id;
  }
  const targetId = (inserted as any)?.id ?? null;
  if (!targetId) return null;
  await ensureAssociations(supabase, {
    organizationId: input.organizationId,
    userId: input.userId,
    executionTargetId: targetId,
    defaultUsername: null,
    label
  });
  return targetId;
}

async function ensureAssociations(
  supabase: SupabaseClient,
  input: {
    organizationId: number;
    userId: string;
    executionTargetId: string;
    label?: string | null;
    defaultUsername?: string | null;
  }
): Promise<void> {
  let label = input.label ?? null;
  if (!label) {
    const { data: existingOrgTarget } = await supabase
      .from('organization_execution_targets')
      .select('label')
      .eq('organization_id', input.organizationId)
      .eq('execution_target_id', input.executionTargetId)
      .maybeSingle();
    label =
      (existingOrgTarget as any)?.label ??
      (await generateLabel(supabase, input.organizationId, input.defaultUsername, 'target'));
  }

  await supabase.from('organization_execution_targets').upsert(
    {
      organization_id: input.organizationId,
      execution_target_id: input.executionTargetId,
      label,
      added_by: input.userId
    },
    { onConflict: 'organization_id,execution_target_id' }
  );
  await supabase.from('user_execution_targets').upsert(
    {
      user_id: input.userId,
      execution_target_id: input.executionTargetId,
      default_username: input.defaultUsername ?? null,
      access_status: 'active',
      last_connected_at: new Date().toISOString()
    },
    { onConflict: 'user_id,execution_target_id' }
  );
}
