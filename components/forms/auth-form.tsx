'use client';

import { GalleryVerticalEnd } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { signIn, signUp } from '@/lib/actions/auth';
import { cn } from '@/lib/utils';

const isRedirectError = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  typeof (err as { digest?: unknown }).digest === 'string' &&
  (err as { digest: string }).digest.startsWith('NEXT_REDIRECT');

type AuthMode = 'login' | 'signup';

type AuthFormProps = {
  className?: string;
  defaultMode?: AuthMode;
  error?: string;
  message?: string;
  next?: string;
};

export function AuthForm({
  className,
  defaultMode = 'login',
  error,
  message,
  next
}: AuthFormProps) {
  const [mode, setMode] = React.useState<AuthMode>(defaultMode);
  const [signInButtonState, setSignInButtonState] = React.useState<ButtonLoadingState>('default');
  const [signUpButtonState, setSignUpButtonState] = React.useState<ButtonLoadingState>('default');

  const isLogin = mode === 'login';

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSignInButtonState('loading');
    const form = e.currentTarget;
    const formData = new FormData(form);
    try {
      await signIn(formData);
      setSignInButtonState('success');
    } catch (err) {
      if (isRedirectError(err)) throw err;
      setSignInButtonState('error');
    }
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSignUpButtonState('loading');
    const form = e.currentTarget;
    const formData = new FormData(form);
    try {
      await signUp(formData);
      setSignUpButtonState('success');
    } catch (err) {
      if (isRedirectError(err)) throw err;
      setSignUpButtonState('error');
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-primary/50 bg-primary/10 px-4 py-3 text-sm text-primary">
          {message}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          variant={isLogin ? 'default' : 'outline'}
          className="flex-1"
          onClick={() => setMode('login')}
        >
          Sign in
        </Button>
        <Button
          type="button"
          variant={!isLogin ? 'default' : 'outline'}
          className="flex-1"
          onClick={() => setMode('signup')}
        >
          Create account
        </Button>
      </div>

      {isLogin ? (
        <form onSubmit={handleSignIn}>
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <FieldGroup>
            <div className="flex flex-col items-center gap-2 text-center">
              <Link href="/" className="flex flex-col items-center gap-2 font-medium">
                <div className="flex size-8 items-center justify-center rounded-md">
                  <GalleryVerticalEnd className="size-6" />
                </div>
                <span className="sr-only">Overlord</span>
              </Link>
              <h1 className="text-xl font-bold">Welcome back</h1>
              <FieldDescription>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  className="underline underline-offset-4 hover:text-foreground"
                  onClick={() => setMode('signup')}
                >
                  Create account
                </button>
              </FieldDescription>
            </div>
            <Field>
              <FieldLabel htmlFor="login-email">Email</FieldLabel>
              <Input
                id="login-email"
                name="email"
                type="email"
                placeholder="m@example.com"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="login-password">Password</FieldLabel>
              <Input id="login-password" name="password" type="password" required minLength={6} />
            </Field>
            <Field>
              <LoadingButton
                type="submit"
                buttonState={signInButtonState}
                setButtonState={setSignInButtonState}
                text="Sign in"
                loadingText="Signing in..."
                errorText="Sign in failed"
              />
            </Field>
          </FieldGroup>
        </form>
      ) : (
        <form onSubmit={handleSignUp}>
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <FieldGroup>
            <div className="flex flex-col items-center gap-2 text-center">
              <Link href="/" className="flex flex-col items-center gap-2 font-medium">
                <div className="flex size-8 items-center justify-center rounded-md">
                  <GalleryVerticalEnd className="size-6" />
                </div>
                <span className="sr-only">Overlord</span>
              </Link>
              <h1 className="text-xl font-bold">Welcome to Overlord</h1>
              <FieldDescription>
                Already have an account?{' '}
                <button
                  type="button"
                  className="underline underline-offset-4 hover:text-foreground"
                  onClick={() => setMode('login')}
                >
                  Sign in
                </button>
              </FieldDescription>
            </div>
            <Field>
              <FieldLabel htmlFor="signup-name">Name</FieldLabel>
              <Input id="signup-name" name="name" type="text" placeholder="Ada Lovelace" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="signup-email">Email</FieldLabel>
              <Input
                id="signup-email"
                name="email"
                type="email"
                placeholder="m@example.com"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="signup-password">Password</FieldLabel>
              <Input id="signup-password" name="password" type="password" required minLength={6} />
            </Field>
            <Field>
              <LoadingButton
                type="submit"
                buttonState={signUpButtonState}
                setButtonState={setSignUpButtonState}
                text="Create Account"
                loadingText="Creating account..."
                successText="Check your email"
                errorText="Sign up failed"
              />
            </Field>
            {/* <FieldSeparator>Or</FieldSeparator>
            <Field className="grid gap-4 sm:grid-cols-2">
              <Button variant="outline" type="button" className="gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-4 shrink-0"
                  aria-hidden
                >
                  <path
                    d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
                    fill="currentColor"
                  />
                </svg>
                Continue with Apple
              </Button>
              <Button variant="outline" type="button" className="gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-4 shrink-0"
                  aria-hidden
                >
                  <path
                    d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                    fill="currentColor"
                  />
                </svg>
                Continue with Google
              </Button>
            </Field> */}
          </FieldGroup>
        </form>
      )}

      {!isLogin ? (
        <FieldDescription className="px-6 text-center">
          By clicking continue, you agree to our{' '}
          <Link href="/terms" className="underline underline-offset-4">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </FieldDescription>
      ) : null}
    </div>
  );
}
