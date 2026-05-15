/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { upsertDeviceFromProtocol } from './_device-upsert.ts';

export async function handleGetDevice(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const deviceFingerprint =
    typeof args?.deviceFingerprint === 'string' ? args.deviceFingerprint.trim() : '';
  if (!deviceFingerprint) {
    return toolErr('deviceFingerprint is required.');
  }

  if (!ctx.userId) {
    return toolErr('Authentication required.');
  }

  const deviceHostname =
    typeof args?.deviceHostname === 'string' ? args.deviceHostname.trim() : null;
  const devicePlatform =
    typeof args?.devicePlatform === 'string' ? args.devicePlatform.trim() : null;

  const deviceId = await upsertDeviceFromProtocol(supabase, {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    deviceFingerprint,
    hostname: deviceHostname,
    platform: devicePlatform
  });

  if (!deviceId) {
    return toolErr('Failed to register device.');
  }

  const { data: device } = await supabase
    .from('devices')
    .select('id, label, hostname, platform, last_seen_at, created_at')
    .eq('id', deviceId)
    .single();

  if (!device) {
    return toolErr('Device not found after registration.');
  }

  return toolOk({
    device: {
      id: (device as any).id,
      label: (device as any).label,
      hostname: (device as any).hostname,
      platform: (device as any).platform,
      lastSeenAt: (device as any).last_seen_at,
      createdAt: (device as any).created_at
    }
  });
}
