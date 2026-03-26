'use server';

import { getPlatformUrl } from '@/lib/env';
import { createClient } from '@/supabase/utils/server';

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
  const supabase = await createClient();
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
  const supabase = await createClient();
  const nextPath = sanitizeNextPath(formData.get('next'), '/u');

  const email = (formData.get('email') as string | null) ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const rawName = (formData.get('name') as string | null) ?? '';
  const name = rawName.trim();

  if (!name) {
    return { error: 'Name is required.' };
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        full_name: name
      },
      emailRedirectTo: `${getPlatformUrl()}/auth/callback?next=${encodeURIComponent('/onboarding')}`
    }
  });

  if (error) {
    return { error: error.message };
  }

  return { redirect: '/confirm-email' };
}

export async function signOut(): Promise<AuthResult> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return { redirect: '/login' };
}

export type OAuthResult = { error?: string; url?: string };

export async function signInWithGithub(next?: string): Promise<OAuthResult> {
  const supabase = await createClient();
  const redirectTo =
    `${getPlatformUrl()}/auth/callback` +
    (next ? `?next=${encodeURIComponent(next)}` : '?next=%2Fu');

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
