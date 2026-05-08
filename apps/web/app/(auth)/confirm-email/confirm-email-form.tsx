'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { getPlatformUrl } from '@/lib/env';
import { createClient } from '@/supabase/utils/client';

type ConfirmEmailFormProps = {
  email?: string;
  initialMessage?: string;
  next?: string;
};

const CODE_LENGTH = 8;

export function ConfirmEmailForm({
  email,
  initialMessage,
  next = '/onboarding'
}: ConfirmEmailFormProps) {
  const router = useRouter();
  const [supabase] = React.useState(createClient);
  const [code, setCode] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [resendButtonState, setResendButtonState] = React.useState<ButtonLoadingState>('default');
  const [error, setError] = React.useState<string>();
  const [message, setMessage] = React.useState<string | undefined>(initialMessage);

  const isMissingEmail = !email;
  const normalizedCode = code.replace(/\D/g, '').slice(0, CODE_LENGTH);
  const isCodeComplete = normalizedCode.length === CODE_LENGTH;

  function navigateAfterConfirmation(redirectPath: string) {
    router.replace(redirectPath);
    setTimeout(() => {
      if (globalThis.location.pathname !== redirectPath) {
        globalThis.location.assign(redirectPath);
      }
    }, 350);
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isMissingEmail) {
      setError('We need your email address to confirm your account. Sign up again to continue.');
      return;
    }

    if (!isCodeComplete) {
      setError('Enter the full 8-digit confirmation code.');
      return;
    }

    setIsSubmitting(true);
    setError(undefined);
    setMessage(undefined);

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: normalizedCode,
        type: 'signup'
      });

      if (verifyError) {
        setError(verifyError.message);
        return;
      }

      navigateAfterConfirmation(next);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (isMissingEmail) {
      setError('We need your email address to resend the confirmation email. Sign up again.');
      setResendButtonState('error');
      return;
    }

    setResendButtonState('loading');
    setError(undefined);
    setMessage(undefined);

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${getPlatformUrl()}/auth/callback?next=${encodeURIComponent(next)}`
        }
      });

      if (resendError) {
        setError(resendError.message);
        setResendButtonState('error');
        return;
      }

      setMessage(`We sent a new confirmation email to ${email}.`);
      setResendButtonState('success');
    } catch {
      setError('Unable to resend the confirmation email. Please try again.');
      setResendButtonState('error');
    }
  };

  return (
    <div className="w-full max-w-md">
      <FieldGroup>
        <div className="rounded-lg border bg-card px-6 py-5 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
          <FieldDescription className="mt-2">
            We&apos;ve sent a confirmation email
            {email ? (
              <>
                {' '}
                to <span className="font-medium">{email}</span>
              </>
            ) : null}
            . Enter the 8-digit code from that email or use the confirmation link to continue to
            Overlord.
          </FieldDescription>

          {error ? (
            <div className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {message ? (
            <div className="mt-4 rounded-md border border-primary/50 bg-primary/10 px-4 py-3 text-sm text-primary">
              {message}
            </div>
          ) : null}

          <form method="post" onSubmit={handleSubmit} className="mt-6">
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="confirmation-code">Confirmation code</FieldLabel>
                <Input
                  id="confirmation-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="12345678"
                  value={code}
                  onChange={event => {
                    setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH));
                  }}
                  maxLength={CODE_LENGTH}
                  disabled={isSubmitting}
                  aria-describedby="confirmation-code-help"
                  className="text-center text-lg tracking-[0.4em]"
                />
                <FieldDescription id="confirmation-code-help">
                  Paste the 8-digit code from your email.
                </FieldDescription>
              </Field>

              <Field className="gap-3">
                <LoadingButton
                  type="submit"
                  buttonState={isSubmitting ? 'loading' : 'default'}
                  text="Confirm email"
                  loadingText="Confirming..."
                  disabled={isMissingEmail || !isCodeComplete}
                />
                <LoadingButton
                  type="button"
                  variant="outline"
                  buttonState={resendButtonState}
                  setButtonState={setResendButtonState}
                  text="Resend confirmation email"
                  loadingText="Resending..."
                  successText="Email sent"
                  errorText="Try again"
                  reset
                  disabled={isMissingEmail}
                  onClick={handleResend}
                />
              </Field>
            </FieldGroup>
          </form>

          <FieldDescription className="mt-4 text-xs">
            If you don&apos;t see the email after a few minutes, check your spam folder or try a
            different address.
          </FieldDescription>

          <div className="mt-6 text-sm">
            <Link href="/login" className="underline underline-offset-4">
              Back to sign in
            </Link>
          </div>
        </div>
      </FieldGroup>
    </div>
  );
}
