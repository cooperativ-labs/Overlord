import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { getPlatformUrl } from '@/lib/env';
import {
  createAnonAuthClient,
  enforceCliAuthRateLimit,
  getClientIp,
  verifyEmailOtp
} from '@/lib/overlord/cli-auth';
import { cliLoginVerifySchema } from '@/lib/overlord/validation';

/**
 * POST /api/auth/cli-login/verify
 *
 * Verifies the email login OTP and returns the resulting Supabase session.
 * Email-login codes verify as `email`. An unknown account or wrong/expired code
 * yields a clear, machine-readable error.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = cliLoginVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload.', code: 'invalid_payload' },
      { status: 400 }
    );
  }

  const { email, token } = parsed.data;
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
      types: ['email'],
      platformUrl
    });

    if (session) {
      return NextResponse.json({ ...session, email });
    }

    return NextResponse.json(
      {
        error: error?.message ?? 'Invalid or expired login code.',
        code: error?.code ?? 'verification_failed'
      },
      { status: 400 }
    );
  } catch (error) {
    return internalErrorResponse(error);
  }
}
