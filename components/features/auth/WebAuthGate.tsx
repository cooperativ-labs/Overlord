'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { isPublicRoute, SESSION_ENDED_MESSAGE } from '@/lib/auth/public-routes';
import { createClient } from '@/supabase/utils/client';

type AuthErrorLike = {
  message?: string;
  name?: string;
  status?: number;
};

function isNetworkError(error: AuthErrorLike | null): boolean {
  if (!error) return false;

  if (typeof error.status === 'number' && error.status >= 500) return true;

  const message = `${error.name ?? ''} ${error.message ?? ''}`.toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('load failed')
  );
}

export function WebAuthGate() {
  const pathname = usePathname();
  const router = useRouter();
  const redirectingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.electronAPI?.auth) return;

    if (isPublicRoute(pathname)) {
      redirectingRef.current = false;
      return;
    }

    const client = createClient();
    let disposed = false;

    const redirectToLogin = () => {
      if (disposed || redirectingRef.current) return;

      redirectingRef.current = true;

      const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const params = new URLSearchParams({
        message: SESSION_ENDED_MESSAGE
      });

      if (nextPath !== '/') {
        params.set('next', nextPath);
      }

      router.replace(`/login?${params.toString()}`);
    };

    const validateSession = async () => {
      if (document.hidden) return;

      const {
        data: { session }
      } = await client.auth.getSession();

      if (disposed) return;

      if (!session) {
        redirectToLogin();
        return;
      }

      const {
        data: { user },
        error
      } = await client.auth.getUser();

      if (disposed || user) return;

      if (!isNetworkError(error)) {
        redirectToLogin();
        return;
      }

      console.warn('Unable to validate session state after tab focus.', error);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void validateSession();
      }
    };

    const handleWindowFocus = () => {
      void validateSession();
    };

    const {
      data: { subscription }
    } = client.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        redirectToLogin();
      }
    });

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    void validateSession();

    return () => {
      disposed = true;
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [pathname, router]);

  return null;
}
