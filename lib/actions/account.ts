'use server';

import * as Sentry from '@sentry/nextjs';
import type { User } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { validateUsername } from '@/lib/account/username';
import { getPlatformUrl } from '@/lib/env';
import { createClientForRequest } from '@/supabase/utils/server';

export type OAuthIdentity = {
  id: string;
  identityId: string;
  provider: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
};

export type ProfileData = {
  name: string;
  email: string;
  imageUrl: string;
  username: string | null;
  hasPassword: boolean;
  identities: OAuthIdentity[];
};

export type LinkIdentityResult = { error?: string; url?: string };

const USER_IMAGES_BUCKET = 'user-images';
const MAX_USER_IMAGE_BYTES = 5 * 1024 * 1024;

function getUserImageUrl(user: User): string {
  return user.user_metadata?.picture ?? user.user_metadata?.avatar_url ?? '';
}

function sanitizeUserImageFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[\\/\0]/g, '-')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) {
    return 'avatar';
  }

  return sanitized.slice(0, 120);
}

function getOwnedUserImageStoragePath(imageUrl: string, userId: string): string | null {
  if (!imageUrl) {
    return null;
  }

  try {
    const url = new URL(imageUrl);
    const prefix = `/storage/v1/object/public/${USER_IMAGES_BUCKET}/`;
    const prefixIndex = url.pathname.indexOf(prefix);

    if (prefixIndex < 0) {
      return null;
    }

    const storagePath = decodeURIComponent(url.pathname.slice(prefixIndex + prefix.length));
    return storagePath.startsWith(`${userId}/`) ? storagePath : null;
  } catch {
    return null;
  }
}

async function updateProfileImageMetadata(
  userId: string,
  imageUrl: string | null,
  supabase: Awaited<ReturnType<typeof createClientForRequest>>
): Promise<void> {
  const { error: authError } = await supabase.auth.updateUser({
    data: {
      avatar_url: imageUrl,
      picture: imageUrl
    }
  });

  if (authError) {
    throw new Error(authError.message ?? 'Failed to update profile image.');
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ image_url: imageUrl ?? '' })
    .eq('id', userId);

  if (profileError) {
    throw new Error(profileError.message ?? 'Failed to sync profile image.');
  }

  revalidatePath('/u');
  revalidatePath('/', 'layout');
}

export async function getProfileDataAction(): Promise<ProfileData> {
  const supabase = await createClientForRequest();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Unauthorized');
  }

  const identities: OAuthIdentity[] = (user.identities ?? []).map(identity => ({
    id: identity.id,
    identityId: identity.identity_id,
    provider: identity.provider,
    email: (identity.identity_data?.email as string | null) ?? null,
    createdAt: identity.created_at ?? new Date().toISOString(),
    lastSignInAt: identity.last_sign_in_at ?? null
  }));

  const hasPassword = (user.identities ?? []).some(i => i.provider === 'email');

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle();

  return {
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? '',
    email: user.email ?? '',
    imageUrl: getUserImageUrl(user),
    username: profile?.username ?? null,
    hasPassword,
    identities
  };
}

export async function updateProfileNameAction(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Name cannot be empty.');
  }

  const supabase = await createClientForRequest();
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

  revalidatePath('/u');
  revalidatePath('/', 'layout');
}

export async function updateUsernameAction(username: string): Promise<{ error?: string }> {
  const validation = validateUsername(username);
  if (validation.error || !validation.username) {
    return { error: validation.error ?? 'Invalid username.' };
  }

  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ username: validation.username })
    .eq('id', user.id);

  if (error) {
    // unique_violation — the case-insensitive unique index rejected the handle.
    if (error.code === '23505') {
      return { error: 'That username is already taken.' };
    }
    return { error: error.message ?? 'Failed to update username.' };
  }

  revalidatePath('/u');
  revalidatePath('/', 'layout');
  return {};
}

export async function updatePasswordAction(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }

  const supabase = await createClientForRequest();
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

  const supabase = await createClientForRequest();
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

export async function linkGithubIdentityAction(): Promise<LinkIdentityResult> {
  const supabase = await createClientForRequest();

  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'github',
    options: {
      redirectTo: `${getPlatformUrl()}/auth/callback?next=${encodeURIComponent(
        '/u?settings=Linked Accounts'
      )}`,
      scopes: 'user:email repo'
    }
  });

  if (error) {
    return { error: error.message };
  }

  return { url: data.url ?? undefined };
}

export async function linkBitbucketIdentityAction(): Promise<LinkIdentityResult> {
  const supabase = await createClientForRequest();

  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'bitbucket',
    options: {
      redirectTo: `${getPlatformUrl()}/auth/callback?next=${encodeURIComponent(
        '/auth/bitbucket-linked'
      )}`,
      scopes: 'account email'
    }
  });

  if (error) {
    return { error: error.message };
  }

  return { url: data.url ?? undefined };
}

export async function disconnectIdentityAction(identityId: string): Promise<LinkIdentityResult> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const identity = (user.identities ?? []).find(
    entry => entry.identity_id === identityId || entry.id === identityId
  );

  if (!identity) {
    return { error: 'Linked account not found.' };
  }

  if ((user.identities ?? []).length <= 1) {
    return {
      error: 'Add another sign-in method before disconnecting your last linked account.'
    };
  }

  const { error } = await supabase.auth.unlinkIdentity(identity);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/u');
  revalidatePath('/', 'layout');

  return {};
}

export async function uploadProfileImageAction(formData: FormData): Promise<string> {
  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new Error('No image provided.');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload an image file.');
  }

  if (file.size > MAX_USER_IMAGE_BYTES) {
    throw new Error('Image must be 5 MB or smaller.');
  }

  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const previousImageUrl = getUserImageUrl(user);
  const previousStoragePath = getOwnedUserImageStoragePath(previousImageUrl, user.id);
  const storagePath = `${user.id}/${Date.now()}-${sanitizeUserImageFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(USER_IMAGES_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (uploadError) {
    throw new Error(uploadError.message ?? 'Failed to upload image.');
  }

  const {
    data: { publicUrl }
  } = supabase.storage.from(USER_IMAGES_BUCKET).getPublicUrl(storagePath);

  try {
    await updateProfileImageMetadata(user.id, publicUrl, supabase);
  } catch (error) {
    await supabase.storage.from(USER_IMAGES_BUCKET).remove([storagePath]);
    throw error;
  }

  if (previousStoragePath) {
    const { error: removeError } = await supabase.storage
      .from(USER_IMAGES_BUCKET)
      .remove([previousStoragePath]);

    if (removeError) {
      console.warn('Failed to remove previous profile image:', removeError.message);
      Sentry.captureMessage(
        `Failed to remove previous profile image: ${removeError.message}`,
        'warning'
      );
    }
  }

  return publicUrl;
}

export async function removeProfileImageAction(): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const currentStoragePath = getOwnedUserImageStoragePath(getUserImageUrl(user), user.id);

  await updateProfileImageMetadata(user.id, null, supabase);

  if (!currentStoragePath) {
    return;
  }

  const { error } = await supabase.storage.from(USER_IMAGES_BUCKET).remove([currentStoragePath]);

  if (error) {
    console.warn('Failed to remove profile image object:', error.message);
    Sentry.captureMessage(`Failed to remove profile image object: ${error.message}`, 'warning');
  }
}
