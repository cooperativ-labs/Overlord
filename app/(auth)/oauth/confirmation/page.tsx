'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

export default function OAuthConfirmationPage({
  searchParams
}: {
  searchParams: { redirect_url?: string };
}) {
  const redirectUrl = searchParams.redirect_url
    ? decodeURIComponent(searchParams.redirect_url)
    : null;

  useEffect(() => {
    if (!redirectUrl) {
      return;
    }

    // Auto-redirect after 2 seconds if we have a redirect URL
    const timer = setTimeout(() => {
      (globalThis as any).location.href = redirectUrl;
    }, 2000);

    return () => {
      clearTimeout(timer);
    };
  }, [redirectUrl]);

  return (
    <div className="w-full max-w-md space-y-6 text-center">
      <div>
        <div className="mb-4 text-5xl">✓</div>
        <h1 className="text-2xl font-semibold">Authorization Complete</h1>
        <p className="mt-2 text-muted-foreground">
          You have successfully authorized the application.
        </p>
      </div>

      {redirectUrl && (
        <>
          <p className="text-sm text-muted-foreground">
            Returning to the application in 2 seconds...
          </p>
          <Button
            onClick={() => {
              (globalThis as any).location.href = redirectUrl;
            }}
            className="w-full"
          >
            Return to Application
          </Button>
        </>
      )}

      {!redirectUrl && (
        <p className="text-sm text-muted-foreground">
          You can close this window and return to the app.
        </p>
      )}
    </div>
  );
}
