import type { AuthError, User } from '@supabase/supabase-js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

/**
 * Server-side helpers shared by the public CLI auth routes
 * (`/api/auth/cli-signup/*`, `/api/auth/cli-login/*`, `/api/auth/agent-token`).
 *
 * These routes own all interaction with Supabase Auth so the CLI never needs a
 * service-role secret. The CLI sends only an email + name + the email
 * confirmation code, and receives a Supabase session (and, by default, a durable
 * `oat_…` agent token) back.
 */

// Public auth endpoints send email and must resist abuse. We cap requests per
// IP and per normalized email within a rolling window, mirroring the spirit of
// the device-auth issuance limiter.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MINUTES = 10;

export type CliAuthAttemptKind = 'signup_request' | 'login_request' | 'verify';

/**
 * Anonymous (publishable-key) Supabase client with no persisted session. Used to
 * call `signUp`, `signInWithOtp`, and `verifyOtp` from the server on the caller's
 * behalf without ever touching the service-role key.
 */
export function createAnonAuthClient(): SupabaseClient<Database> {
  return createClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * Supabase client scoped to a user's access token. RLS runs as that user, so it
 * is safe for user-owned writes such as minting an agent token.
 */
export function createUserScopedAuthClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

/** Normalize an email for comparison and rate-limiting (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Best-available client IP. On Vercel `x-forwarded-for` is set by the edge and
 * trustworthy; we take the first hop only.
 */
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || null;
  }
  return request.headers.get('x-real-ip');
}

export type RateLimitResult = { limited: boolean; retryAfterSeconds: number };

/**
 * Enforce the per-IP and per-email request budget for a CLI auth action, then
 * record the attempt. Counting and recording both run against the
 * `cli_auth_attempts` table via the service-role client. Failures to count fail
 * open (we never block a legitimate caller because of a transient read error),
 * matching the device-auth limiter.
 */
export async function enforceCliAuthRateLimit(input: {
  kind: CliAuthAttemptKind;
  email: string | null;
  ip: string | null;
}): Promise<RateLimitResult> {
  const supabase = createServiceRoleClient();
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const overLimit = async (column: 'requester_ip' | 'email', value: string): Promise<boolean> => {
    const { count, error } = await supabase
      .from('cli_auth_attempts')
      .select('id', { count: 'exact', head: true })
      .eq(column, value)
      .gte('created_at', windowStart);
    return !error && count !== null && count >= RATE_LIMIT_MAX;
  };

  const limited =
    (input.ip ? await overLimit('requester_ip', input.ip) : false) ||
    (input.email ? await overLimit('email', input.email) : false);

  if (limited) {
    return { limited: true, retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 };
  }

  // Record the attempt (best-effort; a write failure must not break signup).
  await supabase
    .from('cli_auth_attempts')
    .insert({
      kind: input.kind,
      email: input.email,
      requester_ip: input.ip
    })
    .then(
      () => {},
      () => {}
    );

  return { limited: false, retryAfterSeconds: 0 };
}

export type CliSession = {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string | null;
  platform_url: string;
};

/** Map a Supabase session into the shape the CLI persists. */
export function toCliSession(
  session: { access_token: string; refresh_token: string; expires_at?: number | null } | null,
  platformUrl: string
): CliSession | null {
  if (!session?.access_token || !session?.refresh_token) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    access_token_expires_at:
      typeof session.expires_at === 'number'
        ? new Date(session.expires_at * 1000).toISOString()
        : null,
    platform_url: platformUrl
  };
}

/**
 * Verify an emailed OTP, trying each `type` in order until one succeeds. Signup
 * codes verify as `signup`; OTP/magic-link codes (passwordless signup and email
 * login) verify as `email`. Returns the resulting session, or the last error.
 */
export async function verifyEmailOtp(
  client: SupabaseClient<Database>,
  input: { email: string; token: string; types: Array<'signup' | 'email'>; platformUrl: string }
): Promise<{ session: CliSession | null; error: AuthError | null }> {
  let lastError: AuthError | null = null;

  for (const type of input.types) {
    const { data, error } = await client.auth.verifyOtp({
      email: input.email,
      token: input.token,
      type
    });
    if (!error && data.session) {
      return { session: toCliSession(data.session, input.platformUrl), error: null };
    }
    lastError = error;
  }

  return { session: null, error: lastError };
}

export function isDuplicateSignupError(error: AuthError | null): boolean {
  if (!error) return false;
  return error.code === 'email_exists' || error.code === 'user_already_exists';
}

/**
 * Look up an auth user by email via the service-role admin API. Returns null when
 * no user matches. Shared with the web signup action so duplicate-unconfirmed
 * handling stays aligned across surfaces.
 */
export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const service = createServiceRoleClient();
  const normalized = normalizeEmail(email);
  let page = 1;

  while (page <= 20) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });

    if (error) {
      throw new Error(error.message ?? 'Failed to inspect existing auth users.');
    }

    const user = data.users.find(candidate => candidate.email?.toLowerCase() === normalized);
    if (user) return user;

    if (!data.nextPage) return null;
    page = data.nextPage;
  }

  return null;
}
