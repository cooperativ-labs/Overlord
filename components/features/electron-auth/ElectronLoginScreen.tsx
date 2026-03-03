'use client';

import { useState } from 'react';

import { createClient } from '@/supabase/utils/client';

type LoginState = 'idle' | 'pending' | 'error';

export function ElectronLoginScreen() {
  const [loginState, setLoginState] = useState<LoginState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  async function handleSignIn() {
    if (!window.electronAPI?.auth) return;

    setLoginState('pending');
    setErrorMessage('');

    try {
      const { session } = await window.electronAPI.auth.login();
      // Establish a Supabase session in the webview so server components can read it
      await createClient().auth.setSession(session);
      // Full reload so Next.js server components pick up the new session cookie
      window.location.href = '/';
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Authorization failed. Please try again.';
      setErrorMessage(message);
      setLoginState('error');
    }
  }

  return (
    <div className="flex min-h-dvh w-full items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Overlord</h1>
          <p className="text-muted-foreground">Sign in to get started</p>
        </div>

        <div className="space-y-4">
          {loginState === 'pending' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                <span>Waiting for browser authorization&hellip;</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Complete sign-in in your browser, then return here.
              </p>
            </div>
          ) : (
            <button
              onClick={handleSignIn}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Sign in with Overlord
            </button>
          )}

          {loginState === 'error' && <p className="text-sm text-destructive">{errorMessage}</p>}
        </div>
      </div>
    </div>
  );
}
