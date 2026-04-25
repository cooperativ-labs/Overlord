import { getSupabaseUrl } from '../../../../lib/env';

export type OAuthConfig = {
  electron_client_id: string;
  electron_redirect_uri?: string | null;
  platform_url: string;
  supabase_url: string;
};

export type OAuthTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

export function computeAccessTokenExpiresAt(data: {
  access_token?: string;
  expires_in?: unknown;
}): string | undefined {
  const expiresIn = Number.parseInt(String(data.expires_in ?? ''), 10);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  const jwtExp = data.access_token ? decodeJwtExpiry(data.access_token) : null;
  return jwtExp ? new Date(jwtExp * 1000).toISOString() : undefined;
}

export async function fetchAuthConfig(platformUrl: string): Promise<OAuthConfig> {
  const res = await fetch(`${platformUrl}/api/auth/config`);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch auth config (${res.status}). Check that Overlord is reachable at ${platformUrl}.`
    );
  }

  const json = (await res.json()) as Partial<OAuthConfig>;
  if (!json.supabase_url || !json.electron_client_id) {
    throw new Error(
      'Auth config is missing supabase_url or electron_client_id. Check SUPABASE_OAUTH_ELECTRON_CLIENT_ID is set.'
    );
  }

  const resolvedPlatformUrl = new URL(res.url).origin;
  return {
    ...json,
    platform_url: resolvedPlatformUrl
  } as OAuthConfig;
}

export async function refreshOAuthTokens(
  platformUrl: string,
  refreshToken: string
): Promise<OAuthTokenResponse> {
  const { supabase_url: supabaseUrl, electron_client_id: clientId } =
    await fetchAuthConfig(platformUrl);

  const res = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${text.slice(0, 180)}`);
  }

  const data = (await res.json()) as OAuthTokenResponse;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in
  };
}

function decodeJwtExpiry(accessToken: string): number | null {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')
    ) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function getSupabaseOrigin(): string {
  return new URL(getSupabaseUrl()).origin;
}
