'use client';

import { createClient } from '@/supabase/utils/client';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let refreshInFlight: Promise<void> | null = null;

function getJwtExpiry(accessToken: string): number | null {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1] ?? ''));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function getSessionExpiryMs(session: {
  access_token?: string;
  expires_at?: number;
}): number | null {
  if (typeof session.expires_at === 'number') {
    return session.expires_at * 1000;
  }

  if (session.access_token) {
    const jwtExpiry = getJwtExpiry(session.access_token);
    return jwtExpiry ? jwtExpiry * 1000 : null;
  }

  return null;
}

async function refreshElectronSession(): Promise<void> {
  const result = await window.electronAPI?.auth.refreshSession();
  if (!result?.ok || !result.session) {
    throw new Error(result?.error || 'Electron session refresh failed.');
  }

  await createClient().auth.setSession(result.session);
}

export async function ensureFreshElectronSession(): Promise<void> {
  if (typeof window === 'undefined' || !window.electronAPI?.auth) return;

  const client = createClient();
  const session = await client.auth
    .getSession()
    .then(result => result.data.session)
    .catch(() => null);

  const expiresAtMs = session ? getSessionExpiryMs(session) : null;
  const isFresh = expiresAtMs !== null && expiresAtMs - Date.now() > REFRESH_MARGIN_MS;
  if (session?.access_token && isFresh) return;

  refreshInFlight ??= refreshElectronSession().finally(() => {
    refreshInFlight = null;
  });

  await refreshInFlight;
}
