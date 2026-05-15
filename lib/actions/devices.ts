'use server';

import { revalidatePath } from 'next/cache';

import { createClientForRequest } from '@/supabase/utils/server';

export type UserDevice = {
  id: string;
  label: string;
  hostname: string | null;
  platform: string | null;
  lastSeenAt: string | null;
  createdAt: string;
};

export async function getUserDevicesAction(): Promise<UserDevice[]> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('devices')
    .select('id, label, hostname, platform, last_seen_at, created_at')
    .eq('user_id', user.id)
    .order('last_seen_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('getUserDevicesAction', error);
    return [];
  }

  return (data ?? []).map(row => ({
    id: row.id,
    label: row.label,
    hostname: row.hostname,
    platform: row.platform,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at
  }));
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

  const { error } = await supabase
    .from('devices')
    .update({ label, updated_at: new Date().toISOString() })
    .eq('id', input.deviceId)
    .eq('user_id', user.id);

  if (error) {
    if (error.code === '23505') {
      throw new Error(`The label "${label}" is already in use by another device.`);
    }
    console.error('updateDeviceLabelAction', error);
    throw new Error(error.message ?? 'Failed to update device label.');
  }

  revalidatePath('/');
}
