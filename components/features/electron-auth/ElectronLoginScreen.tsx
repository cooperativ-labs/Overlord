'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { createClient } from '@/supabase/utils/client';

function sanitizeNextPath(value: string | null, fallback = '/') {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;

  try {
    const parsed = new URL(value, 'http://localhost');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function ElectronLoginScreen() {
  const searchParams = useSearchParams();
  const [signInButtonState, setSignInButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isRestoringSession, setIsRestoringSession] = useState(false);
  const nextPath = sanitizeNextPath(searchParams.get('next'));

  useEffect(() => {
    const electronAuth = window.electronAPI?.auth;
    if (!electronAuth) return;

    let cancelled = false;

    const restoreSession = async () => {
      setIsRestoringSession(true);
      setSignInButtonState('loading');

      try {
        const client = createClient();
        const { data } = await client.auth.getSession();
        if (data.session?.access_token) {
          window.location.href = nextPath;
          return;
        }

        const status = await electronAuth.getStatus();
        if (!status.isAuthenticated) {
          if (!cancelled) {
            setIsRestoringSession(false);
            setSignInButtonState('default');
          }
          return;
        }

        const result = await electronAuth.refreshSession();
        if (!result.ok || !result.session) {
          if (!cancelled) {
            setIsRestoringSession(false);
            setSignInButtonState('default');
          }
          return;
        }

        await client.auth.setSession(result.session);

        if (!cancelled) {
          window.location.href = nextPath;
        }
      } catch (err) {
        console.warn('Electron session recovery failed:', err);
        if (!cancelled) {
          setIsRestoringSession(false);
          setSignInButtonState('default');
        }
      }
    };

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [nextPath]);

  async function handleSignIn() {
    const electronAuth = window.electronAPI?.auth;
    if (!electronAuth) return;

    setIsRestoringSession(false);
    setSignInButtonState('loading');
    setErrorMessage('');

    try {
      const { session } = await electronAuth.login();
      // Establish a Supabase session in the webview so server components can read it.
      // The refresh_token is included so the SSR client can auto-refresh the access token.
      await createClient().auth.setSession(session);
      // Full reload so Next.js server components pick up the new session cookie
      window.location.href = nextPath;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Authorization failed. Please try again.';
      setErrorMessage(message);
      setSignInButtonState('error');
    }
  }

  return (
    <div className="flex w-full items-center justify-center px-4">
      <div className="flex flex-col w-full max-w-md gap-8 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Overlord</h1>
          <p className="text-muted-foreground">Sign in to get started</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-3">
            <LoadingButton
              buttonState={signInButtonState}
              setButtonState={setSignInButtonState}
              text="Sign in with Overlord"
              loadingText={
                isRestoringSession ? 'Restoring session...' : 'Waiting for browser authorization...'
              }
              errorText="Sign in failed"
              variant="default"
              size="lg"
              className="w-full"
              onClick={handleSignIn}
            />
            {signInButtonState === 'loading' && (
              <p className="text-xs text-muted-foreground">
                {isRestoringSession
                  ? 'Trying to restore your previous session...'
                  : 'Complete sign-in in your browser, then return here.'}
              </p>
            )}
          </div>

          {signInButtonState === 'error' && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
