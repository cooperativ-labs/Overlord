import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { getPlatformUrl } from '@/lib/env';
import {
  createAnonAuthClient,
  enforceCliAuthRateLimit,
  getClientIp,
  verifyEmailOtp
} from '@/lib/overlord/cli-auth';
import { cliSignupVerifySchema } from '@/lib/overlord/validation';

/**
 * POST /api/auth/cli-signup/verify
 *
 * Confirms a CLI signup by verifying the 8-digit email code and returns the
 * resulting Supabase session (access + refresh token, expiry, platform URL).
 * Password signups verify as `signup`; passwordless OTP signups verify as
 * `email`, so we try both. When a password was used we sign in with it as a
 * fallback in case verification confirms the email without returning a session.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = cliSignupVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload.', code: 'invalid_payload' },
      { status: 400 }
    );
  }

  const { email, token, password } = parsed.data;
  const ip = getClientIp(request);

  const rate = await enforceCliAuthRateLimit({ kind: 'verify', email, ip });
  if (rate.limited) {
    return NextResponse.json(
      {
        error: 'Too many verification attempts. Please wait before trying again.',
        code: 'rate_limited'
      },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  try {
    const platformUrl = getPlatformUrl();
    const supabase = createAnonAuthClient();

    const { session, error } = await verifyEmailOtp(supabase, {
      email,
      token,
      types: ['signup', 'email'],
      platformUrl
    });

    if (session) {
      return NextResponse.json({ ...session, email });
    }

    // Verification may confirm the email without returning a session in some
    // configurations. If the caller supplied a password, complete the login.
    if (password) {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (!signInError && data.session) {
        return NextResponse.json({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          access_token_expires_at:
            typeof data.session.expires_at === 'number'
              ? new Date(data.session.expires_at * 1000).toISOString()
              : null,
          platform_url: platformUrl,
          email
        });
      }
    }

    return NextResponse.json(
      {
        error: error?.message ?? 'Invalid or expired confirmation code.',
        code: error?.code ?? 'verification_failed'
      },
      { status: 400 }
    );
  } catch (error) {
    return internalErrorResponse(error);
  }
}
