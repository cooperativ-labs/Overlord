'use client';

type RouteRefreshTarget = {
  refresh: () => void;
};

export async function refreshElectronRoute(target: RouteRefreshTarget): Promise<void> {
  if (typeof window !== 'undefined' && window.electronAPI?.auth) {
    await window.electronAPI.auth.forceRefresh();
  }

  target.refresh();
}
