import type { Session } from 'electron';

import {
  ELECTRON_CLIENT_HEADER,
  ELECTRON_CLIENT_VALUE
} from '../../../../lib/auth/electron-detect';

import type { RefreshController } from './refresh-controller';

type RequestHeaders = Record<string, string | string[] | undefined>;
type ResponseHeaders = Record<string, string[] | undefined>;
type NormalizedRequestHeaders = Record<string, string | string[]>;
type NormalizedResponseHeaders = Record<string, string[]>;

export type RequestScope = 'platform' | 'supabase';
const SUPABASE_AUTH_COOKIE_PREFIXES = ['sb-', 'supabase-auth-token'];

export function buildAuthRequestUrlPatterns(
  platformOrigin: string,
  supabaseOrigin: string
): string[] {
  return unique([...buildOriginPatterns(platformOrigin), ...buildOriginPatterns(supabaseOrigin)]);
}

export function resolveRequestScope(
  requestUrl: string,
  platformOrigin: string,
  supabaseOrigin: string
): RequestScope | null {
  const origin = normalizeComparableOrigin(getRequestOrigin(requestUrl));
  if (!origin) return null;
  if (origin === normalizeComparableOrigin(platformOrigin)) return 'platform';
  if (origin === normalizeComparableOrigin(supabaseOrigin)) return 'supabase';
  return null;
}

export function injectBearerHeaders(options: {
  requestUrl: string;
  requestHeaders: RequestHeaders;
  accessToken?: string | null;
  platformOrigin: string;
  supabaseOrigin: string;
}): NormalizedRequestHeaders {
  const scope = resolveRequestScope(
    options.requestUrl,
    options.platformOrigin,
    options.supabaseOrigin
  );
  const nextHeaders = normalizeRequestHeaders(options.requestHeaders);
  if (!scope) {
    return nextHeaders;
  }

  if (options.accessToken) {
    delete nextHeaders.Authorization;
    delete nextHeaders.authorization;
    nextHeaders.Authorization = `Bearer ${options.accessToken}`;
  }

  if (scope === 'platform') {
    delete nextHeaders[ELECTRON_CLIENT_HEADER];
    delete nextHeaders[electronClientHeaderLowerCase];
    nextHeaders[ELECTRON_CLIENT_HEADER] = ELECTRON_CLIENT_VALUE;
  }

  return nextHeaders;
}

export function composeRendererResponseHeaders(
  responseHeaders: ResponseHeaders,
  csp: string,
  requestUrl?: string,
  platformOrigin?: string
): NormalizedResponseHeaders {
  const nextHeaders = normalizeResponseHeaders(responseHeaders);
  nextHeaders['Content-Security-Policy'] = [csp];

  if (requestUrl && platformOrigin && isSameOrigin(requestUrl, platformOrigin)) {
    stripSupabaseAuthSetCookies(nextHeaders);
  }

  return nextHeaders;
}

export function installRendererResponseHeaders(
  session: Session,
  csp: string,
  platformOrigin: string
): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: composeRendererResponseHeaders(
        details.responseHeaders ?? {},
        csp,
        details.url,
        platformOrigin
      )
    });
  });
}

export function installAuthHeaderInjector(options: {
  session: Session;
  platformOrigin: string;
  supabaseOrigin: string;
  refreshController: RefreshController;
}): void {
  const requestPatterns = buildAuthRequestUrlPatterns(
    options.platformOrigin,
    options.supabaseOrigin
  );

  options.session.webRequest.onBeforeSendHeaders(
    { urls: requestPatterns },
    async (details, callback) => {
      let accessToken: string | null = null;

      try {
        accessToken = await options.refreshController.getValidAccessToken();
      } catch {
        // Logged-out Electron navigations still need the desktop marker so the
        // platform can route them to /electron-login instead of the web login.
      }

      callback({
        requestHeaders: injectBearerHeaders({
          requestUrl: details.url,
          requestHeaders: details.requestHeaders,
          accessToken,
          platformOrigin: options.platformOrigin,
          supabaseOrigin: options.supabaseOrigin
        })
      });
    }
  );
}

function buildOriginPatterns(origin: string): string[] {
  const patterns = [ensurePathPattern(origin)];
  try {
    const parsed = new URL(origin);
    const socketProtocol =
      parsed.protocol === 'https:' ? 'wss:' : parsed.protocol === 'http:' ? 'ws:' : null;
    if (socketProtocol) {
      const socketUrl = new URL(origin);
      socketUrl.protocol = socketProtocol;
      patterns.push(ensurePathPattern(socketUrl.origin));
    }
  } catch {
    // Ignore invalid origins. The caller will fail earlier when constructing them.
  }
  return patterns;
}

function ensurePathPattern(origin: string): string {
  return origin.endsWith('/') ? `${origin}*` : `${origin}/*`;
}

function getRequestOrigin(requestUrl: string): string | null {
  try {
    return new URL(requestUrl).origin;
  } catch {
    return null;
  }
}

function normalizeComparableOrigin(origin: string | null): string | null {
  if (!origin) return null;

  try {
    const parsed = new URL(origin);
    if (parsed.protocol === 'ws:') {
      parsed.protocol = 'http:';
    } else if (parsed.protocol === 'wss:') {
      parsed.protocol = 'https:';
    }
    return parsed.origin;
  } catch {
    return origin;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const electronClientHeaderLowerCase = ELECTRON_CLIENT_HEADER.toLowerCase();

function normalizeRequestHeaders(headers: RequestHeaders): NormalizedRequestHeaders {
  const nextHeaders: NormalizedRequestHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'undefined') continue;
    nextHeaders[key] = value;
  }
  return nextHeaders;
}

function normalizeResponseHeaders(headers: ResponseHeaders): NormalizedResponseHeaders {
  const nextHeaders: NormalizedResponseHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    nextHeaders[key] = value;
  }
  return nextHeaders;
}

function stripSupabaseAuthSetCookies(headers: NormalizedResponseHeaders): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== 'set-cookie') continue;

    const filtered = (headers[key] ?? []).filter(value => !isSupabaseAuthSetCookie(value));
    if (filtered.length > 0) {
      headers[key] = filtered;
    } else {
      delete headers[key];
    }
  }
}

function isSupabaseAuthSetCookie(value: string): boolean {
  const cookieName = value.split(';', 1)[0]?.split('=', 1)[0]?.trim().toLowerCase();
  if (!cookieName) return false;
  return SUPABASE_AUTH_COOKIE_PREFIXES.some(prefix => cookieName.startsWith(prefix));
}

function isSameOrigin(requestUrl: string, origin: string): boolean {
  return (
    normalizeComparableOrigin(getRequestOrigin(requestUrl)) === normalizeComparableOrigin(origin)
  );
}
