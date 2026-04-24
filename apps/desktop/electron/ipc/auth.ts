import { ipcMain, shell } from 'electron';
import crypto from 'node:crypto';
import http from 'node:http';

import {
  clearElectronCredentials,
  loadElectronCredentials,
  saveElectronCredentials
} from '../services/electron-credentials';

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier(): string {
  return crypto.randomBytes(96).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// Redirect + callback listener
// ---------------------------------------------------------------------------

const DEFAULT_ELECTRON_REDIRECT_URI = 'http://127.0.0.1:45620/callback';

// Track the active callback server so we can close it before starting a new one.
// This prevents EADDRINUSE when Electron hot-reloads or the user retries login.
let activeCallbackServer: http.Server | null = null;

type LoopbackRedirect = {
  callbackPath: string;
  host: string;
  port: number;
  redirectUri: string;
};

function parseLoopbackRedirectUri(rawValue: string): LoopbackRedirect {
  const value = rawValue.trim();
  if (!value) {
    throw new Error('OAuth redirect URI is missing.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid OAuth redirect URI: ${value}`);
  }

  if (parsed.protocol !== 'http:') {
    throw new Error('OAuth redirect URI must use http:// for loopback callbacks.');
  }

  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('OAuth redirect URI host must be 127.0.0.1 or localhost.');
  }

  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`OAuth redirect URI must include a valid port: ${value}`);
  }

  const callbackPath = parsed.pathname || '/';
  return {
    callbackPath,
    host: parsed.hostname,
    port,
    redirectUri: `${parsed.origin}${callbackPath}`
  };
}

function closeActiveCallbackServer(): Promise<void> {
  return new Promise(resolve => {
    if (activeCallbackServer) {
      const server = activeCallbackServer;
      activeCallbackServer = null;
      server.close(() => resolve());
      // Force-close open connections so .close() doesn't hang
      server.closeAllConnections?.();
    } else {
      resolve();
    }
  });
}

function waitForOAuthCallback(
  host: string,
  port: number,
  callbackPath: string,
  expectedState: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${host}:${port}`);
      if (url.pathname !== callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const errorParam = url.searchParams.get('error');

      const html = (title: string, body: string) =>
        `<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>${title}</h2><p>${body}</p></body></html>`;

      res.writeHead(200, { 'Content-Type': 'text/html' });

      if (errorParam) {
        res.end(html('Authorization Denied', 'You can close this window and return to Overlord.'));
        activeCallbackServer = null;
        server.close();
        reject(new Error(`Authorization denied: ${errorParam}`));
        return;
      }

      if (returnedState !== expectedState) {
        res.end(html('Error', 'State mismatch. Please try again.'));
        activeCallbackServer = null;
        server.close();
        reject(new Error('State mismatch — possible CSRF. Please try again.'));
        return;
      }

      if (!code) {
        res.end(html('Error', 'No authorization code received.'));
        activeCallbackServer = null;
        server.close();
        reject(new Error('No authorization code in callback.'));
        return;
      }

      res.end(html('Authorization Complete', 'You can close this window and return to Overlord.'));
      activeCallbackServer = null;
      server.close();
      resolve(code);
    });

    activeCallbackServer = server;
    server.listen(port, host);
    server.on('error', (err: NodeJS.ErrnoException) => {
      activeCallbackServer = null;
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `OAuth callback port ${port} is already in use. ` +
              'Close the application using that port or check for firewall/proxy interference, then try again.'
          )
        );
      } else {
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

async function fetchAuthConfig(platformUrl: string): Promise<{
  electron_client_id: string;
  electron_redirect_uri?: string | null;
  platform_url: string;
  supabase_url: string;
}> {
  const res = await fetch(`${platformUrl}/api/auth/config`);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch auth config (${res.status}). Check that Overlord is reachable at ${platformUrl}.`
    );
  }
  const json = await res.json();
  if (!json.supabase_url || !json.electron_client_id) {
    throw new Error(
      'Auth config is missing supabase_url or electron_client_id. Check SUPABASE_OAUTH_ELECTRON_CLIENT_ID is set.'
    );
  }

  const resolvedPlatformUrl = new URL(res.url).origin;
  return {
    ...json,
    platform_url: resolvedPlatformUrl
  } as {
    electron_client_id: string;
    electron_redirect_uri?: string | null;
    platform_url: string;
    supabase_url: string;
  };
}

async function exchangeCodeForSupabaseTokens(
  supabaseUrl: string,
  clientId: string,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expires_in?: number }> {
  const res = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 180)}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in
  };
}

async function fetchOrganizations(
  platformUrl: string,
  accessToken: string
): Promise<Array<{ id: number; name: string }>> {
  const res = await fetch(`${platformUrl}/api/auth/organizations`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Organization lookup failed (${res.status}): ${text.slice(0, 180)}`);
  }

  const data = (await res.json()) as { organizations?: Array<{ id: number; name: string }> };
  return Array.isArray(data.organizations) ? data.organizations : [];
}

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------

type SupabaseSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

async function performLogin(platformUrl: string): Promise<SupabaseSession> {
  // 1. Discover OAuth config from the platform
  const {
    supabase_url: supabaseUrl,
    electron_client_id: clientId,
    electron_redirect_uri: configuredRedirectUri,
    platform_url: resolvedPlatformUrl
  } = await fetchAuthConfig(platformUrl);

  // 2. PKCE parameters + state
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // 3. Use exact loopback redirect URI (Supabase does not support wildcard callback URLs)
  const { redirectUri, host, port, callbackPath } = parseLoopbackRedirectUri(
    configuredRedirectUri ?? DEFAULT_ELECTRON_REDIRECT_URI
  );

  // 3b. Close any leftover callback server from a previous attempt or hot-reload
  await closeActiveCallbackServer();

  // 4. Build the Supabase OAuth authorization URL
  const authorizeUrl = new URL(`${supabaseUrl}/auth/v1/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', 'openid email');

  // 5. Pre-flight the authorize request from Node.js (cookie-free) to get
  //    the consent page redirect URL. When the browser opens the authorize
  //    URL directly, Kong may reject it due to stale cookies from Supabase
  //    Studio on the same localhost domain.
  let browserUrl = authorizeUrl.toString();
  try {
    const authorizeRes = await fetch(browserUrl, { redirect: 'manual' });
    const location = authorizeRes.headers.get('location');
    if (authorizeRes.status >= 300 && authorizeRes.status < 400 && location) {
      browserUrl = location;
    }
  } catch {
    // Fall back to opening the authorize URL directly
  }

  // 6. Start listener before opening browser
  const callbackPromise = waitForOAuthCallback(host, port, callbackPath, state);

  // 7. Open browser to the consent page (or authorize URL as fallback)
  await shell.openExternal(browserUrl);

  // 8. Wait for the auth code
  const authCode = await callbackPromise;

  // 9. Exchange auth code → Supabase tokens
  const supabaseTokens = await exchangeCodeForSupabaseTokens(
    supabaseUrl,
    clientId,
    authCode,
    codeVerifier,
    redirectUri
  );

  const organizations = await fetchOrganizations(resolvedPlatformUrl, supabaseTokens.access_token);
  const defaultOrganizationId = organizations[0]?.id ?? null;

  // 10. Persist credentials including refresh token for session renewal
  saveElectronCredentials({
    access_token: supabaseTokens.access_token,
    access_token_expires_at:
      typeof supabaseTokens.expires_in === 'number' && supabaseTokens.expires_in > 0
        ? new Date(Date.now() + supabaseTokens.expires_in * 1000).toISOString()
        : undefined,
    refresh_token: supabaseTokens.refresh_token,
    organization_id: defaultOrganizationId,
    platform_url: resolvedPlatformUrl
  });

  return {
    access_token: supabaseTokens.access_token,
    refresh_token: supabaseTokens.refresh_token
  };
}

// ---------------------------------------------------------------------------
// OAuth token refresh
// ---------------------------------------------------------------------------
// The @supabase/ssr auto-refresh calls /auth/v1/token?grant_type=refresh_token,
// which is the standard GoTrue endpoint. OAuth-issued refresh tokens require
// the OAuth endpoint (/auth/v1/oauth/token) with the client_id parameter.
// Without this, the browser session silently expires every jwt_expiry interval
// (default 3600s) and the user is forced to re-login.
//
// This function calls the correct OAuth endpoint so the Electron main process
// can refresh tokens on behalf of the webview.
// ---------------------------------------------------------------------------

async function refreshOAuthTokens(
  platformUrl: string,
  refreshToken: string
): Promise<SupabaseSession> {
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

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in
  };
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

type RegisterAuthIpcOptions = {
  getPlatformUrl: () => string;
};

export function registerAuthIpc({ getPlatformUrl }: RegisterAuthIpcOptions): void {
  ipcMain.handle('auth:login', async () => {
    const platformUrl = getPlatformUrl();
    const session = await performLogin(platformUrl);
    return { ok: true, session };
  });

  ipcMain.handle('auth:logout', () => {
    clearElectronCredentials();
    return { ok: true };
  });

  ipcMain.handle('auth:getStatus', () => {
    const credentials = loadElectronCredentials();
    return {
      isAuthenticated: credentials !== null,
      platformUrl: credentials?.platform_url ?? null,
      supabaseRefreshToken: credentials?.refresh_token ?? null
    };
  });

  ipcMain.handle('auth:saveRefreshToken', (_, refreshToken: string) => {
    const credentials = loadElectronCredentials();
    if (credentials && refreshToken) {
      saveElectronCredentials({ ...credentials, refresh_token: refreshToken });
    }
    return { ok: true };
  });

  const checkOAuthSession = async () => {
    const credentials = loadElectronCredentials();
    if (!credentials?.refresh_token) {
      return { valid: false, reason: 'no_token' };
    }
    return { valid: true };
  };

  ipcMain.handle('auth:checkOAuthSession', checkOAuthSession);
  ipcMain.handle('auth:checkAgentToken', checkOAuthSession);

  const refreshOAuthSession = async () => {
    const credentials = loadElectronCredentials();
    if (!credentials?.refresh_token) {
      return { ok: false, error: 'No refresh token available' };
    }

    try {
      const session = await refreshOAuthTokens(credentials.platform_url, credentials.refresh_token);

      saveElectronCredentials({
        ...credentials,
        access_token: session.access_token,
        access_token_expires_at:
          typeof session.expires_in === 'number' && session.expires_in > 0
            ? new Date(Date.now() + session.expires_in * 1000).toISOString()
            : credentials.access_token_expires_at,
        refresh_token: session.refresh_token
      });

      return { ok: true, accessToken: session.access_token };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'OAuth session refresh failed'
      };
    }
  };

  ipcMain.handle('auth:refreshOAuthSession', refreshOAuthSession);
  ipcMain.handle('auth:refreshAgentToken', refreshOAuthSession);

  // Refresh the Supabase session via the OAuth token endpoint.
  // Called by ElectronAuthGate to proactively renew tokens before expiry.
  ipcMain.handle('auth:refreshSession', async () => {
    const credentials = loadElectronCredentials();
    if (!credentials?.refresh_token) {
      return { ok: false, error: 'No refresh token available' };
    }

    try {
      const session = await refreshOAuthTokens(credentials.platform_url, credentials.refresh_token);

      saveElectronCredentials({
        ...credentials,
        access_token: session.access_token,
        access_token_expires_at:
          typeof session.expires_in === 'number' && session.expires_in > 0
            ? new Date(Date.now() + session.expires_in * 1000).toISOString()
            : credentials.access_token_expires_at,
        refresh_token: session.refresh_token
      });

      return { ok: true, session };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Refresh failed' };
    }
  });
}
