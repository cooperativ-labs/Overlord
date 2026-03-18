'use server';

import { redirect } from 'next/navigation';

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

function authRedirectPath(path: '/login' | '/signup', error: string, nextPath: string): string {
  const params = new URLSearchParams({ error });
  if (nextPath !== '/u') params.set('next', nextPath);
  return `${path}?${params.toString()}`;
}

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const nextPath = sanitizeNextPath(formData.get('next'), '/u');

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string
  });

  if (error) {
    redirect(authRedirectPath('/login', error.message, nextPath));
  }

  redirect(nextPath);
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();
  const nextPath = sanitizeNextPath(formData.get('next'), '/u');

  const email = (formData.get('email') as string | null) ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const rawName = (formData.get('name') as string | null) ?? '';
  const name = rawName.trim();

  if (!name) {
    redirect(authRedirectPath('/signup', 'Name is required.', nextPath));
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
    redirect(authRedirectPath('/signup', error.message, nextPath));
  }

  redirect('/confirm-email');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
