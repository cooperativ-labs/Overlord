'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { isElectronBearerAuthEnabled } from '@/supabase/utils/client';

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
        router.replace('/electron-login');
      }
    };

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
