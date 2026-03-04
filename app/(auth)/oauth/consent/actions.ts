'use server';

import { redirect } from 'next/navigation';

import { createClient } from '@/supabase/utils/server';

export async function approveAuthorization(authorizationId: string): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/(auth)/login?next=${encodeURIComponent(`/(auth)/oauth/consent?authorization_id=${authorizationId}`)}`
    );
  }

  const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId);

  if (error || !data) {
    redirect('/(auth)/oauth/consent?error=approval_failed');
  }

  redirect(`/(auth)/oauth/confirmation?redirect_url=${encodeURIComponent(data.redirect_url)}`);
}

export async function denyAuthorization(authorizationId: string): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/(auth)/login?next=${encodeURIComponent(`/(auth)/oauth/consent?authorization_id=${authorizationId}`)}`
    );
  }

  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId);

  if (error || !data) {
    redirect('/(auth)/oauth/consent?error=denial_failed');
  }

  redirect(data.redirect_url);
}
