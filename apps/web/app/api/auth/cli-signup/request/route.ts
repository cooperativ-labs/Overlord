import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { getPlatformUrl } from '@/lib/env';
import {
  createAnonAuthClient,
  enforceCliAuthRateLimit,
  findAuthUserByEmail,
  getClientIp,
  isDuplicateSignupError
} from '@/lib/overlord/cli-auth';
import { cliSignupRequestSchema } from '@/lib/overlord/validation';

/**
 * POST /api/auth/cli-signup/request
 *
 * Public, terminal-first account creation. The CLI sends an email + name (and
 * optionally a password-manager password). We start a Supabase signup so the
 * confirmation email is sent, then the caller finishes via
 * /api/auth/cli-signup/verify with the emailed code. No browser is required.
 *
 * Passwordless signups use Supabase OTP semantics (no hidden durable password is
 * ever generated); future login then relies on `ovld auth login --email`.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = cliSignupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload.', code: 'invalid_payload' },
      { status: 400 }
    );
  }

  const { email, name, password, inviteToken } = parsed.data;
  const ip = getClientIp(request);

  const rate = await enforceCliAuthRateLimit({ kind: 'signup_request', email, ip });
  if (rate.limited) {
    return NextResponse.json(
      { error: 'Too many signup requests. Please wait before trying again.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  try {
    const supabase = createAnonAuthClient();
    // Preserve parity with web signup: invite signups land back on the invite
    // accept flow after confirmation; everyone else continues to onboarding.
    const postConfirmPath = inviteToken ? `/invite/${inviteToken}` : '/onboarding';
    const emailRedirectTo = `${getPlatformUrl()}/auth/callback?next=${encodeURIComponent(postConfirmPath)}`;
    const userData = { name, full_name: name };

    // With a password we use password signup (verify type 'signup'); without one
    // we use OTP signup that creates the user and emails a login code (type 'email').
    const passwordless = !password;
    const { error } = passwordless
      ? await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true, data: userData, emailRedirectTo }
        })
      : await supabase.auth.signUp({
          email,
          password,
          options: { data: userData, emailRedirectTo }
        });

    if (error) {
      // Duplicate password-signup: resend confirmation for unconfirmed accounts,
      // otherwise tell the agent to log in instead of creating a new account.
      if (isDuplicateSignupError(error)) {
        const existing = await findAuthUserByEmail(email);
        if (existing && !existing.email_confirmed_at) {
          await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo } });
          return NextResponse.json({ email, status: 'confirmation_required', passwordless: false });
        }
        return NextResponse.json(
          {
            error:
              'An account already exists for this email. Use `ovld auth login --email` instead.',
            code: 'account_exists'
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: error.message, code: error.code ?? 'signup_failed' },
        { status: 400 }
      );
    }

    return NextResponse.json({ email, status: 'confirmation_required', passwordless });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
