'use server';

import { createClientForRequest } from '@/supabase/utils/server';

export type PasskeyEntry = {
  id: string;
  friendlyName: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type PasskeyActionResult = { error?: string };

export async function listPasskeysAction(): Promise<PasskeyEntry[]> {
  const supabase = await createClientForRequest();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase.auth.passkey.list();

  if (error) {
    throw new Error(error.message ?? 'Failed to list passkeys.');
  }

  return (data ?? []).map(pk => ({
    id: pk.id,
    friendlyName: pk.friendly_name ?? '',
    createdAt: pk.created_at,
    lastUsedAt: pk.last_used_at ?? null
  }));
}

export async function renamePasskeyAction(
  passkeyId: string,
  friendlyName: string
): Promise<PasskeyActionResult> {
  const trimmed = friendlyName.trim();
  if (!trimmed) {
    return { error: 'Name cannot be empty.' };
  }
  if (trimmed.length > 120) {
    return { error: 'Name must be 120 characters or fewer.' };
  }

  const supabase = await createClientForRequest();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: 'Unauthorized' };
  }

  const { error } = await supabase.auth.passkey.update({
    passkeyId,
    friendlyName: trimmed
  });

  if (error) {
    return { error: error.message ?? 'Failed to rename passkey.' };
  }

  return {};
}

export async function deletePasskeyAction(passkeyId: string): Promise<PasskeyActionResult> {
  const supabase = await createClientForRequest();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: 'Unauthorized' };
  }

  const { error } = await supabase.auth.passkey.delete({ passkeyId });

  if (error) {
    return { error: error.message ?? 'Failed to delete passkey.' };
  }

  return {};
}
