'use server';

import { getPlatformUrl } from '@/lib/env';
import { createClientForRequest } from '@/supabase/utils/server';

function sanitizeNextPath(value: FormDataEntryValue | null, fallback: string): string {
  if (typeof value !== 'string') return fallback;

  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;

  try {
    const parsed = new URL(trimmed, 'http://localhost');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export type AuthResult = { error?: string; redirect?: string };

export async function signIn(formData: FormData): Promise<AuthResult> {
  const supabase = await createClientForRequest();
  const nextPath = sanitizeNextPath(formData.get('next'), '/u');

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string
  });

  if (error) {
    return { error: error.message };
  }

  return { redirect: nextPath };
}

export async function signUp(formData: FormData): Promise<AuthResult> {
  const supabase = await createClientForRequest();
  const nextPath = sanitizeNextPath(formData.get('next'), '/u');

  const email = ((formData.get('email') as string | null) ?? '').trim();
  const password = (formData.get('password') as string | null) ?? '';
  const rawName = (formData.get('name') as string | null) ?? '';
  const name = rawName.trim();
  const inviteToken = ((formData.get('invite_token') as string | null) ?? '').trim();

  if (!name) {
    return { error: 'Name is required.' };
  }

  // When an invite token is present, redirect through the invite accept page after email confirmation
  const postConfirmPath = inviteToken ? `/invite/${inviteToken}` : '/onboarding';

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        full_name: name
      },
      emailRedirectTo: `${getPlatformUrl()}/auth/callback?next=${encodeURIComponent(postConfirmPath)}`
    }
  });

  if (error) {
    return { error: error.message };
  }

  const params = new URLSearchParams({ email, next: nextPath });

  return { redirect: `/confirm-email?${params.toString()}` };
}

export async function signOut(): Promise<AuthResult> {
  const supabase = await createClientForRequest();
  await supabase.auth.signOut();
  return { redirect: '/login' };
}

export type OAuthResult = { error?: string; url?: string };

export async function signInWithGithub(next?: string, inviteToken?: string): Promise<OAuthResult> {
  const supabase = await createClientForRequest();
  const effectiveNext = inviteToken ? `/invite/${inviteToken}` : (next ?? '/u');
  const redirectTo =
    `${getPlatformUrl()}/auth/callback` + `?next=${encodeURIComponent(effectiveNext)}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo,
      scopes: 'user:email'
    }
  });

  if (error) {
    return { error: error.message };
  }

  return { url: data.url ?? undefined };
}

export async function signInWithBitbucket(
  next?: string,
  inviteToken?: string
): Promise<OAuthResult> {
  const supabase = await createClientForRequest();
  const effectiveNext = inviteToken ? `/invite/${inviteToken}` : (next ?? '/u');
  const redirectTo =
    `${getPlatformUrl()}/auth/callback` + `?next=${encodeURIComponent(effectiveNext)}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'bitbucket',
    options: {
      redirectTo,
      scopes: 'account email'
    }
  });

  if (error) {
    return { error: error.message };
  }

  return { url: data.url ?? undefined };
}
