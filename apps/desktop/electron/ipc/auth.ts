import * as Sentry from '@sentry/electron/main';
import { ipcMain, session as electronSession, shell } from 'electron';
import crypto from 'node:crypto';
import http from 'node:http';

import { clearElectronCredentials } from '../services/electron-credentials';
import {
  computeAccessTokenExpiresAt,
  fetchAuthConfig,
  refreshOAuthTokens
} from '../services/oauth-tokens';
import { createRefreshController } from '../services/refresh-controller';
import { createElectronSessionStore, type ElectronSession } from '../services/session-store';

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

const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PORT_START = 45620;
const LOOPBACK_PORT_END = 45629;
const LOOPBACK_CALLBACK_PATH = '/callback';

// Track the active callback server so we can close it before starting a new one.
// This prevents EADDRINUSE when Electron hot-reloads or the user retries login.
let activeCallbackServer: http.Server | null = null;

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

function createCallbackServer(
  host: string,
  port: number,
  callbackPath: string,
  expectedState: string
): Promise<{ server: http.Server; codePromise: Promise<string> }> {
  return new Promise((resolve, reject) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

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
        rejectCode(new Error(`Authorization denied: ${errorParam}`));
        return;
      }

      if (returnedState !== expectedState) {
        res.end(html('Error', 'State mismatch. Please try again.'));
        activeCallbackServer = null;
        server.close();
        rejectCode(new Error('State mismatch — possible CSRF. Please try again.'));
        return;
      }

      if (!code) {
        res.end(html('Error', 'No authorization code received.'));
        activeCallbackServer = null;
        server.close();
        rejectCode(new Error('No authorization code in callback.'));
        return;
      }

      res.end(html('Authorization Complete', 'You can close this window and return to Overlord.'));
      activeCallbackServer = null;
      server.close();
      resolveCode(code);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(err);
    });

    server.listen(port, host, () => {
      activeCallbackServer = server;
      resolve({ server, codePromise });
    });
  });
}

async function bindLoopbackServer(
  expectedState: string
): Promise<{ port: number; redirectUri: string; codePromise: Promise<string> }> {
  const bindFailures: number[] = [];

  for (let port = LOOPBACK_PORT_START; port <= LOOPBACK_PORT_END; port++) {
    try {
      const { codePromise } = await createCallbackServer(
        LOOPBACK_HOST,
        port,
        LOOPBACK_CALLBACK_PATH,
        expectedState
      );
      if (bindFailures.length > 0) {
        console.warn('[auth] Loopback bind succeeded after skipping occupied ports', {
          skipped: bindFailures,
          bound: port
        });
      }
      return {
        port,
        redirectUri: `http://${LOOPBACK_HOST}:${port}${LOOPBACK_CALLBACK_PATH}`,
        codePromise
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        Sentry.addBreadcrumb({
          category: 'electron_auth',
          level: 'warning',
          message: 'electron_auth.loopback_bind_failed',
          data: { port }
        });
        console.warn('[auth] Loopback port in use, trying next', { port });
        bindFailures.push(port);
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `All loopback callback ports (${LOOPBACK_PORT_START}–${LOOPBACK_PORT_END}) are in use. ` +
      'Close other Overlord instances or local processes using those ports, then try again.'
  );
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

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

type RendererSessionResponse = {
  access_token: string;
};

async function performLogin(
  platformUrl: string,
  saveSession: (session: ElectronSession) => void
): Promise<RendererSessionResponse> {
  // 1. Discover OAuth config from the platform
  const {
    supabase_url: supabaseUrl,
    electron_client_id: clientId,
    platform_url: resolvedPlatformUrl
  } = await fetchAuthConfig(platformUrl);

  // 2. PKCE parameters + state
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // 3. Close any leftover callback server from a previous attempt or hot-reload
  await closeActiveCallbackServer();

  // 4. Bind the first available loopback port from the registered range
  const { redirectUri, codePromise: callbackPromise } = await bindLoopbackServer(state);

  // 5. Build the Supabase OAuth authorization URL
  const authorizeUrl = new URL(`${supabaseUrl}/auth/v1/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', 'openid email');

  // 6. Pre-flight the authorize request from Node.js (cookie-free) to get
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
  saveSession({
    platformUrl: resolvedPlatformUrl,
    accessToken: supabaseTokens.access_token,
    accessTokenExpiresAt: computeAccessTokenExpiresAt(supabaseTokens),
    refreshToken: supabaseTokens.refresh_token,
    organizationId: defaultOrganizationId
  });

  return {
    access_token: supabaseTokens.access_token
  };
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

type RegisterAuthIpcOptions = {
  getPlatformUrl: () => string;
  sessionStore?: ReturnType<typeof createElectronSessionStore>;
  refreshController?: ReturnType<typeof createRefreshController>;
};

export function registerAuthIpc({
  getPlatformUrl,
  sessionStore = createElectronSessionStore(),
  refreshController = createRefreshController({
    store: sessionStore,
    refreshTokens: async ({ platformUrl, refreshToken }) => {
      const session = await refreshOAuthTokens(platformUrl, refreshToken);
      return {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        accessTokenExpiresAt: computeAccessTokenExpiresAt(session)
      };
    }
  })
}: RegisterAuthIpcOptions): void {
  const buildAccessTokenResponse = (accessToken: string) => ({
    ok: true,
    accessToken,
    accessTokenExpiresAt: sessionStore.getSession()?.accessTokenExpiresAt ?? null
  });

  const addRefreshBreadcrumb = (
    message:
      | 'electron_auth.refresh_attempt'
      | 'electron_auth.refresh_success'
      | 'electron_auth.refresh_failed',
    data: Record<string, unknown>,
    level: 'info' | 'warning' | 'error' = 'info'
  ) => {
    Sentry.addBreadcrumb({
      category: 'electron_auth',
      level,
      message,
      data
    });
  };

  const refreshSession = async (
    forceRefresh: boolean,
    reason: 'preemptive' | 'on_401' | 'first_boot'
  ) => {
    const startedAt = Date.now();
    const previousRefreshToken = sessionStore.getSession()?.refreshToken ?? null;
    addRefreshBreadcrumb('electron_auth.refresh_attempt', { reason });

    try {
      const accessToken = forceRefresh
        ? await refreshController.forceRefresh()
        : await refreshController.getValidAccessToken();

      const session = sessionStore.getSession();
      if (!session?.refreshToken) {
        return { ok: false, error: 'No refresh token available' };
      }

      addRefreshBreadcrumb('electron_auth.refresh_success', {
        rotated: previousRefreshToken !== null && previousRefreshToken !== session.refreshToken,
        latency_ms: Date.now() - startedAt
      });

      return {
        ok: true,
        session: {
          access_token: accessToken
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refresh failed';
      const statusMatch = message.match(/\((\d{3})\)/);
      addRefreshBreadcrumb(
        'electron_auth.refresh_failed',
        {
          code: message.split(':')[0] || 'refresh_failed',
          ...(statusMatch ? { status: Number(statusMatch[1]) } : {})
        },
        'error'
      );

      return {
        ok: false,
        error: message
      };
    }
  };

  const revokeOAuthGrant = async (currentSession: ElectronSession): Promise<void> => {
    const accessToken =
      currentSession.accessToken ??
      (await refreshController.getValidAccessToken().catch(() => null));
    if (!accessToken) return;

    const { supabase_url: supabaseUrl, electron_client_id: clientId } = await fetchAuthConfig(
      currentSession.platformUrl
    );

    const response = await fetch(`${supabaseUrl}/auth/v1/oauth/revoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ client_id: clientId })
    });

    if (!response.ok) {
      throw new Error(`OAuth revoke failed (${response.status})`);
    }
  };

  ipcMain.handle('auth:login', async () => {
    const platformUrl = getPlatformUrl();
    const session = await performLogin(platformUrl, sessionStore.setSession);
    return { ok: true, session };
  });

  ipcMain.handle('auth:logout', async () => {
    const currentSession = sessionStore.getSession();

    if (currentSession) {
      try {
        await revokeOAuthGrant(currentSession);
      } catch (err) {
        console.warn('[auth] OAuth grant revoke failed', err);
      }
    }

    clearElectronCredentials();
    sessionStore.clear();

    const platformOrigin = currentSession?.platformUrl
      ? new URL(currentSession.platformUrl).origin
      : null;
    if (platformOrigin) {
      await electronSession.defaultSession.clearStorageData({
        origin: platformOrigin,
        storages: ['cookies']
      });
    }

    return { ok: true };
  });

  ipcMain.handle('auth:getStatus', () => {
    const session = sessionStore.getSession();
    return {
      isAuthenticated: session !== null,
      platformUrl: session?.platformUrl ?? null
    };
  });

  ipcMain.handle('auth:getAccessToken', async () => {
    const currentSession = sessionStore.getSession();
    const result = await refreshSession(
      false,
      currentSession?.accessToken ? 'preemptive' : 'first_boot'
    );
    if (!result.ok || !result.session) {
      return {
        ok: false,
        error: result.error ?? 'Unable to load access token.'
      };
    }

    return buildAccessTokenResponse(result.session.access_token);
  });

  ipcMain.handle('auth:forceRefresh', async () => {
    const result = await refreshSession(true, 'on_401');
    if (!result.ok || !result.session) {
      return {
        ok: false,
        error: result.error ?? 'Refresh failed'
      };
    }

    return buildAccessTokenResponse(result.session.access_token);
  });

  // Refresh the Supabase session via the OAuth token endpoint.
  ipcMain.handle('auth:refreshSession', async () => {
    const result = await refreshSession(false, 'preemptive');
    if (!result.ok || !result.session) {
      return result;
    }

    return {
      ok: true,
      session: result.session
    };
  });
}
