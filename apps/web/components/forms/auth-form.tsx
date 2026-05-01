'use client';

import { GalleryVerticalEnd } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { signIn, signInWithBitbucket, signInWithGithub, signUp } from '@/lib/actions/auth';
import { cn } from '@/lib/utils';

type AuthMode = 'login' | 'signup';

type FormSubmitEvent = { preventDefault: () => void; currentTarget: HTMLFormElement };

type AuthFormProps = {
  className?: string;
  mode: AuthMode;
  error?: string;
  message?: string;
  next?: string;
};

function withNext(path: string, next?: string): string {
  if (!next) return path;
  const params = new URLSearchParams({ next });
  return `${path}?${params.toString()}`;
}

export function AuthForm({ className, mode, error: initialError, message, next }: AuthFormProps) {
  const router = useRouter();
  const [signInButtonState, setSignInButtonState] = React.useState<ButtonLoadingState>('default');
  const [signUpButtonState, setSignUpButtonState] = React.useState<ButtonLoadingState>('default');
  const [githubButtonState, setGithubButtonState] = React.useState<ButtonLoadingState>('default');
  const [bitbucketButtonState, setBitbucketButtonState] =
    React.useState<ButtonLoadingState>('default');
  const [formError, setFormError] = React.useState<string | undefined>(initialError);

  const isLogin = mode === 'login';

  const navigateAfterAuth = React.useCallback(
    (redirectPath: string) => {
      router.replace(redirectPath);
      // Safari can occasionally fail to complete client-side navigation
      // immediately after auth cookie writes, so force a document navigation fallback.
      setTimeout(() => {
        if (globalThis.location.pathname !== redirectPath) {
          globalThis.location.assign(redirectPath);
        }
      }, 350);
    },
    [router]
  );

  const handleSignIn = async (e: FormSubmitEvent) => {
    e.preventDefault();
    setSignInButtonState('loading');
    setFormError(undefined);
    const form = e.currentTarget;
    const formData = new FormData(form);
    try {
      const result = await signIn(formData);
      if (result.error) {
        setFormError(result.error);
        setSignInButtonState('error');
      } else if (result.redirect) {
        setSignInButtonState('success');
        navigateAfterAuth(result.redirect);
      }
    } catch {
      setFormError('Something went wrong. Please try again.');
      setSignInButtonState('error');
    }
  };

  const handleSignUp = async (e: FormSubmitEvent) => {
    e.preventDefault();
    setSignUpButtonState('loading');
    setFormError(undefined);
    const form = e.currentTarget;
    const formData = new FormData(form);
    try {
      const result = await signUp(formData);
      if (result.error) {
        setFormError(result.error);
        setSignUpButtonState('error');
      } else if (result.redirect) {
        setSignUpButtonState('success');
        router.push(result.redirect);
      }
    } catch {
      setFormError('Something went wrong. Please try again.');
      setSignUpButtonState('error');
    }
  };

  const handleGithubSignIn = async () => {
    setGithubButtonState('loading');
    setFormError(undefined);
    try {
      const result = await signInWithGithub(next);
      if (result.error) {
        setFormError(result.error);
        setGithubButtonState('error');
      } else if (result.url) {
        setGithubButtonState('success');
        globalThis.location.assign(result.url);
      }
    } catch {
      setFormError('Something went wrong. Please try again.');
      setGithubButtonState('error');
    }
  };

  const handleBitbucketSignIn = async () => {
    setBitbucketButtonState('loading');
    setFormError(undefined);
    try {
      const result = await signInWithBitbucket(next);
      if (result.error) {
        setFormError(result.error);
        setBitbucketButtonState('error');
      } else if (result.url) {
        setBitbucketButtonState('success');
        globalThis.location.assign(result.url);
      }
    } catch {
      setFormError('Something went wrong. Please try again.');
      setBitbucketButtonState('error');
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {formError ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {formError}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-primary/50 bg-primary/10 px-4 py-3 text-sm text-primary">
          {message}
        </div>
      ) : null}

      {isLogin ? (
        <form method="post" onSubmit={handleSignIn}>
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
                <Link href={withNext('/signup', next)} className="underline underline-offset-4">
                  Create account
                </Link>
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
        <form method="post" onSubmit={handleSignUp}>
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
                <Link href={withNext('/login', next)} className="underline underline-offset-4">
                  Sign in
                </Link>
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

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-2">
        <LoadingButton
          type="button"
          variant="outline"
          buttonState={githubButtonState}
          setButtonState={setGithubButtonState}
          onClick={handleGithubSignIn}
          text={
            <span className="flex items-center justify-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="size-4 shrink-0"
                aria-hidden
              >
                <path
                  d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                  fill="currentColor"
                />
              </svg>
              Continue with GitHub
            </span>
          }
          loadingText="Redirecting..."
          errorText="GitHub sign-in failed"
        />

        <LoadingButton
          type="button"
          variant="outline"
          buttonState={bitbucketButtonState}
          setButtonState={setBitbucketButtonState}
          onClick={handleBitbucketSignIn}
          text={
            <span className="flex items-center justify-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="size-4 shrink-0"
                aria-hidden
                fill="currentColor"
              >
                <path d="M.778 1.213a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.892zM14.52 15.53H9.522L8.17 8.466h7.767z" />
              </svg>
              Continue with Bitbucket
            </span>
          }
          loadingText="Redirecting..."
          errorText="Bitbucket sign-in failed"
        />
      </div>

      {isLogin ? (
        <p className="px-1 text-center text-xs text-muted-foreground">
          If this email already has a password account, sign in first and connect GitHub or
          Bitbucket from Settings &gt; Profile.
        </p>
      ) : null}

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
