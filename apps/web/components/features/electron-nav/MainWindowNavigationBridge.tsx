'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function MainWindowNavigationBridge() {
  const router = useRouter();

  useEffect(() => {
    const onNavigate = window.electronAPI?.app?.onNavigate;
    if (!onNavigate) return;

    return onNavigate(path => {
      if (typeof path !== 'string' || !path.startsWith('/')) return;
      router.push(path);
    });
  }, [router]);

  return null;
}
