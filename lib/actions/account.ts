'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/supabase/utils/server';

export type OAuthIdentity = {
  id: string;
  provider: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
};

export type ProfileData = {
  name: string;
  email: string;
  hasPassword: boolean;
  identities: OAuthIdentity[];
};

export async function getProfileDataAction(): Promise<ProfileData> {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Unauthorized');
  }

  const identities: OAuthIdentity[] = (user.identities ?? []).map(identity => ({
    id: identity.id,
    provider: identity.provider,
    email: (identity.identity_data?.email as string | null) ?? null,
    createdAt: identity.created_at ?? new Date().toISOString(),
    lastSignInAt: identity.last_sign_in_at ?? null
  }));

  const hasPassword = (user.identities ?? []).some(i => i.provider === 'email');

  return {
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? '',
    email: user.email ?? '',
    hasPassword,
    identities
  };
}

export async function updateProfileNameAction(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Name cannot be empty.');
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const { error: authError } = await supabase.auth.updateUser({
    data: { full_name: trimmed, name: trimmed }
  });

  if (authError) {
    throw new Error(authError.message ?? 'Failed to update name.');
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ name: trimmed })
    .eq('id', user.id);

  if (profileError) {
    throw new Error(profileError.message ?? 'Failed to update profile name.');
  }

  revalidatePath('/account');
}

export async function updatePasswordAction(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    throw new Error('Unauthorized');
  }

  // Verify current password by signing in
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword
  });

  if (verifyError) {
    throw new Error('Current password is incorrect.');
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    throw new Error(error.message ?? 'Failed to update password.');
  }
}

export async function setPasswordAction(newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    throw new Error(error.message ?? 'Failed to set password.');
  }
}
