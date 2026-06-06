'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

function buildElectronLoginPath(): string {
  const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const params = new URLSearchParams();
  if (nextPath !== '/' && nextPath !== '/electron-login') {
    params.set('next', nextPath);
  }
  const query = params.toString();
  return query ? `/electron-login?${query}` : '/electron-login';
}

/**
 * Shown by the desktop app layout when the server could not authenticate the
 * request (no `user`). This replaces what used to be a chrome-less, half-rendered
 * app — Kanban board visible but no sidebar/nav and no reachable logout. It
 * states plainly that the session ended and routes to the sign-in screen, which
 * clears any dead session and lets the user sign back in.
 */
export function ElectronSessionEndedScreen() {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.location.assign(buildElectronLoginPath());
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your session has ended</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your desktop session expired or was signed out. Sign in again to continue — your work is
          saved on the server.
        </p>
      </div>
      <Button onClick={() => window.location.assign(buildElectronLoginPath())}>
        Sign in again
      </Button>
    </div>
  );
}
