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

/**
 * Raised when an OAuth token refresh fails. `terminal` distinguishes an
 * unrecoverable failure (the refresh token itself is expired, revoked, or
 * otherwise rejected — `invalid_grant`) from a transient one (network blip,
 * 5xx) that may succeed on a later attempt. Callers use this to decide whether
 * to clear the persisted session and force the user back to sign-in, versus
 * simply retrying later.
 */
export class OAuthRefreshError extends Error {
  constructor(
    message: string,
    public readonly terminal: boolean,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'OAuthRefreshError';
  }
}

/**
 * A refresh is unrecoverable when the authorization server actively rejects the
 * refresh token. Supabase/GoTrue returns 400 (with an `invalid_grant` body) or
 * 401 for a dead/revoked refresh token; 403 means the grant was revoked. Any
 * other status (network errors, 5xx, 429) is treated as transient.
 */
function isTerminalRefreshFailure(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  if (status === 400) {
    return /invalid_grant|invalid_request|invalid_token|bad_refresh/i.test(body);
  }
  return false;
}

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
    throw new OAuthRefreshError(
      `OAuth token refresh failed (${res.status}): ${text.slice(0, 180)}`,
      isTerminalRefreshFailure(res.status, text),
      res.status
    );
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
