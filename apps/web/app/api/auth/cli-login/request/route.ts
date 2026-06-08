import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import {
  createAnonAuthClient,
  enforceCliAuthRateLimit,
  getClientIp
} from '@/lib/overlord/cli-auth';
import { cliLoginRequestSchema } from '@/lib/overlord/validation';

/**
 * POST /api/auth/cli-login/request
 *
 * Sends a fresh email OTP/magic-link login code for an EXISTING account
 * (`shouldCreateUser: false`). Powers `ovld auth login --email` so an agent can
 * re-authenticate after local logout without the original signup password.
 *
 * To avoid leaking which emails have accounts, an unknown email returns the same
 * `confirmation_required` status as a known one; verification simply fails later.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = cliLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload.', code: 'invalid_payload' },
      { status: 400 }
    );
  }

  const { email } = parsed.data;
  const ip = getClientIp(request);

  const rate = await enforceCliAuthRateLimit({ kind: 'login_request', email, ip });
  if (rate.limited) {
    return NextResponse.json(
      { error: 'Too many login requests. Please wait before trying again.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  try {
    const supabase = createAnonAuthClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    });

    // Surface genuine send failures, but treat "user not found" as success so we
    // do not disclose account existence. Supabase reports this as 422/otp_disabled
    // style errors; we map anything user-existence-related to the neutral response.
    if (error && error.status && error.status >= 500) {
      return NextResponse.json(
        { error: error.message, code: error.code ?? 'login_request_failed' },
        { status: 502 }
      );
    }

    return NextResponse.json({ email, status: 'confirmation_required' });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
