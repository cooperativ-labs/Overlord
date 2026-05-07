'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { isElectronBearerAuthEnabled } from '@/supabase/utils/client';

function buildElectronLoginPath() {
  const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const params = new URLSearchParams();
  if (nextPath !== '/' && nextPath !== '/electron-login') {
    params.set('next', nextPath);
  }
  const query = params.toString();
  return query ? `/electron-login?${query}` : '/electron-login';
}

export function ElectronAuthGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!window.electronAPI?.auth) return;
    if (!isElectronBearerAuthEnabled()) return;
    if (pathname === '/electron-login') return;

    let cancelled = false;

    const checkSession = async () => {
      const status = await window.electronAPI?.auth.getStatus();
      if (!cancelled && !status?.isAuthenticated) {
        router.replace(buildElectronLoginPath());
      }
    };

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}

export function ElectronAuthBoundary({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState(true);

  useEffect(() => {
    if (!window.electronAPI?.auth) {
      setIsAuthenticated(true);
      return;
    }
    if (!isElectronBearerAuthEnabled()) {
      setIsAuthenticated(true);
      return;
    }
    if (pathname === '/electron-login') {
      setIsAuthenticated(true);
      return;
    }

    let cancelled = false;

    const checkSession = async () => {
      try {
        const status = await window.electronAPI?.auth.getStatus();
        if (cancelled) return;

        if (!status?.isAuthenticated) {
          setIsAuthenticated(false);
          router.replace(buildElectronLoginPath());
          return;
        }

        const tokenResult = await window.electronAPI?.auth.getAccessToken();
        if (cancelled) return;

        if (tokenResult?.ok) {
          setIsAuthenticated(true);
          return;
        }

        setIsAuthenticated(false);
        router.replace(buildElectronLoginPath());
      } catch {
        if (!cancelled) {
          setIsAuthenticated(false);
          router.replace(buildElectronLoginPath());
        }
      }
    };

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (!isElectronBearerAuthEnabled() || isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-dvh w-full items-center justify-center px-4 text-sm text-muted-foreground">
      Checking desktop session...
    </div>
  );
}
