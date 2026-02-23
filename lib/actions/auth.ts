'use server';

import { redirect } from 'next/navigation';

import { getPlatformUrl } from '@/lib/env';
import { createClient } from '@/supabase/utils/server';

export async function signIn(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string
  });

  if (error) {
    redirect('/login?error=' + encodeURIComponent(error.message));
  }

  redirect('/onboarding');
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();

  const email = (formData.get('email') as string | null) ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const rawName = (formData.get('name') as string | null) ?? '';
  const name = rawName.trim();

  if (!name) {
    redirect('/login?error=' + encodeURIComponent('Name is required.'));
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        full_name: name
      },
      emailRedirectTo: `${getPlatformUrl()}/auth/callback?next=/onboarding`
    }
  });

  if (error) {
    redirect('/login?error=' + encodeURIComponent(error.message));
  }

  redirect(`/confirm-email?email=${encodeURIComponent(email)}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
