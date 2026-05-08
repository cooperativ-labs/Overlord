'use server';

import type { AuthError } from '@supabase/auth-js';

import { getPlatformUrl } from '@/lib/env';
import { createClientForRequest } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

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

const RECOVERED_SIGNUP_MESSAGE =
  'You already started signing up with this email. We sent a fresh confirmation email so you can finish creating your account.';

function buildConfirmEmailRedirect(email: string, nextPath: string, message?: string): string {
  const params = new URLSearchParams({ email, next: nextPath });

  if (message) {
    params.set('message', message);
  }

  return `/confirm-email?${params.toString()}`;
}

function isDuplicateSignupError(error: AuthError | null): boolean {
  if (!error) return false;

  return error.code === 'email_exists' || error.code === 'user_already_exists';
}

async function findAuthUserByEmail(email: string) {
  const service = createServiceRoleClient();
  let page = 1;

  while (page <= 20) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });

    if (error) {
      throw new Error(error.message ?? 'Failed to inspect existing auth users.');
    }

    const user = data.users.find(candidate => candidate.email?.toLowerCase() === email.toLowerCase());

    if (user) {
      return user;
    }

    if (!data.nextPage) {
      return null;
    }

    page = data.nextPage;
  }

  return null;
}

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

  // Preserve the destination we want after confirmation, but force invite signups
  // back through the invite accept flow so OTP verification and resend stay aligned.
  const postConfirmPath = inviteToken ? `/invite/${inviteToken}` : nextPath;
  const confirmEmailRedirectTo = buildConfirmEmailRedirect(email, postConfirmPath);
  const emailRedirectTo = `${getPlatformUrl()}/auth/callback?next=${encodeURIComponent(postConfirmPath)}`;

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        full_name: name
      },
      emailRedirectTo
    }
  });

  if (error) {
    if (isDuplicateSignupError(error)) {
      const existingUser = await findAuthUserByEmail(email);

      if (existingUser && !existingUser.email_confirmed_at) {
        await supabase.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo }
        });

        return {
          redirect: buildConfirmEmailRedirect(email, postConfirmPath, RECOVERED_SIGNUP_MESSAGE)
        };
      }
    }

    return { error: error.message };
  }

  return { redirect: confirmEmailRedirectTo };
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
