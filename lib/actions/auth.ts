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

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const nextPath = sanitizeNextPath(formData.get('next'), '/(auth)/onboarding');

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string
  });

  if (error) {
    redirect('/(auth)/login?error=' + encodeURIComponent(error.message));
  }

  redirect(nextPath);
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();
  const nextPath = sanitizeNextPath(formData.get('next'), '/(auth)/onboarding');

  const email = (formData.get('email') as string | null) ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const rawName = (formData.get('name') as string | null) ?? '';
  const name = rawName.trim();

  if (!name) {
    redirect('/(auth)/login?error=' + encodeURIComponent('Name is required.'));
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        full_name: name
      },
      emailRedirectTo: `${getPlatformUrl()}/auth/callback?next=${encodeURIComponent(nextPath)}`
    }
  });

  if (error) {
    redirect('/(auth)/login?error=' + encodeURIComponent(error.message));
  }

  redirect(`/(auth)/confirm-email?email=${encodeURIComponent(email)}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/(auth)/login');
}
