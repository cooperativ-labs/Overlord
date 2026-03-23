'use client';

import { useEffect, useMemo } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Validate that a redirect URL points to a trusted origin.
 * Allows same-origin, localhost, 127.0.0.1, and custom schemes (e.g. ovld://).
 */
function isAllowedRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return true;
    return false;
  } catch {
    return false;
  }
}

export default function OAuthConfirmationPage({
  searchParams
}: {
  searchParams: { redirect_url?: string };
}) {
  const redirectUrl = useMemo(() => {
    if (!searchParams.redirect_url) return null;
    const decoded = decodeURIComponent(searchParams.redirect_url);
    return isAllowedRedirect(decoded) ? decoded : null;
  }, [searchParams.redirect_url]);

  useEffect(() => {
    if (!redirectUrl) {
      return;
    }

    // Auto-redirect after 2 seconds if we have a validated redirect URL
    const timer = setTimeout(() => {
      window.location.href = redirectUrl;
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
              window.location.href = redirectUrl;
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
