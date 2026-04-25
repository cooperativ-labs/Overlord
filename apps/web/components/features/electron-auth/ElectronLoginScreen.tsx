'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';

function sanitizeNextPath(value: string | null, fallback = '/u') {
  if (!value || value === '/') return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;

  try {
    const parsed = new URL(value, 'http://localhost');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function ElectronLoginScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [signInButtonState, setSignInButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isRestoringSession, setIsRestoringSession] = useState(false);
  const [showRefreshButton, setShowRefreshButton] = useState(false);
  const refreshTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextPath = sanitizeNextPath(searchParams.get('next'));

  // Stable ref so the effect doesn't re-run when router identity changes.
  const routerRef = React.useRef(router);
  routerRef.current = router;
  const nextPathRef = React.useRef(nextPath);
  nextPathRef.current = nextPath;

  useEffect(() => {
    const electronAuth = window.electronAPI?.auth;
    if (!electronAuth) return;

    let cancelled = false;

    const giveUp = () => {
      if (!cancelled) {
        setIsRestoringSession(false);
        setSignInButtonState('default');
      }
    };

    const restoreSession = async () => {
      setIsRestoringSession(true);
      setSignInButtonState('loading');

      try {
        const status = await electronAuth.getStatus();
        if (cancelled) return;
        if (status.isAuthenticated) {
          const tokenResult = await electronAuth.getAccessToken();
          if (!cancelled && tokenResult?.ok) {
            routerRef.current.replace(nextPathRef.current);
            return;
          }
        }
        giveUp();
      } catch (err) {
        console.warn('Electron session recovery failed:', err);
        giveUp();
      }
    };

    // Race: if restore hasn't finished in 2 s, give up and show the sign-in button.
    const timeout = setTimeout(giveUp, 2000);
    void restoreSession().finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  async function handleLogout() {
    await window.electronAPI?.auth.logout?.();
    setIsRestoringSession(false);
    setSignInButtonState('default');
  }

  async function handleSignIn() {
    const electronAuth = window.electronAPI?.auth;
    if (!electronAuth) return;

    setIsRestoringSession(false);
    setSignInButtonState('loading');
    setErrorMessage('');
    setShowRefreshButton(false);

    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => setShowRefreshButton(true), 5000);

    try {
      await electronAuth.login();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      window.location.href = nextPath;
    } catch (err) {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      setShowRefreshButton(false);
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
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {isRestoringSession
                    ? 'Trying to restore your previous session...'
                    : 'Complete sign-in in your browser, then return here.'}
                </p>
                {isRestoringSession && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                    onClick={handleLogout}
                  >
                    Log out
                  </button>
                )}
                {!isRestoringSession && showRefreshButton && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                    onClick={() => window.location.reload()}
                  >
                    Refresh page
                  </button>
                )}
              </div>
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
