import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { isPublicRoute } from '@/lib/auth/public-routes';
import {
  getPlatformUrl,
  getSupabaseCookieOptions,
  getSupabasePublishableKey,
  getSupabaseUrl
} from '@/lib/env';

const CANONICAL_HOST = 'www.ovld.ai';
const ELECTRON_AUTH_REDIRECT_REFRESH_MARGIN_MS = 30_000;

type ElectronCookieSessionState =
  | { status: 'fresh'; expiresInSeconds: number | null }
  | { status: 'expired'; expiresInSeconds: number | null }
  | { status: 'missing' | 'missing_access_token' | 'unreadable' | 'unknown_expiry' };

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getJwtExpiry(accessToken: string): number | null {
  try {
    const payload = JSON.parse(base64UrlDecode(accessToken.split('.')[1] ?? '')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function getSupabaseStorageKey(): string {
  const supabaseUrl = new URL(getSupabaseUrl());
  return `sb-${supabaseUrl.hostname.split('.')[0]}-auth-token`;
}

function getCookieStorageValue(request: NextRequest, storageKey: string): string | null {
  const exactCookie = request.cookies.get(storageKey)?.value;
  if (exactCookie) return exactCookie;

  const chunks: string[] = [];
  for (let index = 0; index < 20; index += 1) {
    const chunk = request.cookies.get(`${storageKey}.${index}`)?.value;
    if (!chunk) break;
    chunks.push(chunk);
  }

  return chunks.length > 0 ? chunks.join('') : null;
}

function getElectronCookieSessionState(request: NextRequest): ElectronCookieSessionState {
  const rawValue = getCookieStorageValue(request, getSupabaseStorageKey());
  if (!rawValue) return { status: 'missing' };

  try {
    const decodedValue = rawValue.startsWith('base64-')
      ? base64UrlDecode(rawValue.slice('base64-'.length))
      : rawValue;
    const session = JSON.parse(decodedValue) as {
      access_token?: unknown;
      expires_at?: unknown;
    };
    const accessToken = typeof session.access_token === 'string' ? session.access_token : null;
    if (!accessToken) return { status: 'missing_access_token' };

    const expiresAt =
      typeof session.expires_at === 'number' ? session.expires_at : getJwtExpiry(accessToken);
    if (!expiresAt) return { status: 'unknown_expiry' };

    const expiresInMs = expiresAt * 1000 - Date.now();
    const expiresInSeconds = Math.round(expiresInMs / 1000);
    return expiresInMs > ELECTRON_AUTH_REDIRECT_REFRESH_MARGIN_MS
      ? { status: 'fresh', expiresInSeconds }
      : { status: 'expired', expiresInSeconds };
  } catch {
    return { status: 'unreadable' };
  }
}

function getRefererPath(request: NextRequest): string | null {
  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    const parsed = new URL(referer);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function getSupabaseAuthCookieCount(request: NextRequest): number {
  return request.cookies.getAll().filter(cookie => cookie.name.includes('auth-token')).length;
}

function logElectronAuthRedirect(
  request: NextRequest,
  details: {
    authErrorMessage?: string | null;
    authErrorName?: string | null;
    authErrorStatus?: number | null;
    cookieSessionStatus?: ElectronCookieSessionState['status'] | null;
    reason: string;
  }
) {
  console.error('[overlord:electron-auth-redirect]', {
    authErrorMessage: details.authErrorMessage ?? null,
    authErrorName: details.authErrorName ?? null,
    authErrorStatus: details.authErrorStatus ?? null,
    cookieSessionStatus: details.cookieSessionStatus ?? null,
    hasNextActionHeader: request.headers.has('next-action'),
    method: request.method,
    pathname: request.nextUrl.pathname,
    reason: details.reason,
    refererPath: getRefererPath(request),
    supabaseCookieCount: getSupabaseAuthCookieCount(request),
    vercelId: request.headers.get('x-vercel-id')
  });
}

function redirectToLogin(request: NextRequest, isElectron: boolean): NextResponse {
  const url = request.nextUrl.clone();
  const nextUrl = request.nextUrl.clone();
  nextUrl.searchParams.delete('_rsc');
  const nextPath = `${nextUrl.pathname}${nextUrl.search}`;
  url.pathname = isElectron ? '/electron-login' : '/login';
  url.searchParams.set('next', nextPath);

  const redirectStatus = request.method === 'GET' || request.method === 'HEAD' ? 307 : 303;
  return NextResponse.redirect(url, redirectStatus);
}

export async function updateSession(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  if (hostname === 'ovld.ai') {
    const url = request.nextUrl.clone();
    const canonical = new URL(getPlatformUrl());
    url.protocol = canonical.protocol;
    url.hostname = CANONICAL_HOST;
    return NextResponse.redirect(url);
  }

  // Machine-facing auth/protocol endpoints do not use browser Supabase session
  // cookies. Bypass refresh so stale Electron/webview cookies cannot trigger
  // noisy refresh-token errors on public config or bearer-token requests.
  if (
    request.nextUrl.pathname.startsWith('/api/auth') ||
    request.nextUrl.pathname.startsWith('/api/protocol') ||
    request.nextUrl.pathname.startsWith('/api/mcp')
  ) {
    return NextResponse.next({ request });
  }

  // Electron sessions are refreshed by the desktop main process against the
  // OAuth token endpoint. If the webview cookie is already expired, do not let
  // @supabase/ssr attempt the standard refresh endpoint in middleware; send
  // the renderer to the Electron login bridge so it can restore via IPC.
  const isElectron = request.headers.get('user-agent')?.includes('Electron') ?? false;
  const isProtectedRoute = !isPublicRoute(request.nextUrl.pathname);
  if (isElectron && isProtectedRoute) {
    const cookieSessionState = getElectronCookieSessionState(request);
    if (
      cookieSessionState.status === 'missing' ||
      cookieSessionState.status === 'missing_access_token' ||
      cookieSessionState.status === 'expired'
    ) {
      logElectronAuthRedirect(request, {
        cookieSessionStatus: cookieSessionState.status,
        reason: 'electron_cookie_not_fresh'
      });
      return redirectToLogin(request, true);
    }
  }

  let supabaseResponse = NextResponse.next({
    request
  });

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: getSupabaseCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      }
    }
  });

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: DO NOT REMOVE auth.getUser()

  const {
    data: { user },
    error: getUserError
  } = await supabase.auth.getUser();

  // In the Electron app, /login should always go to /electron-login.
  if (isElectron && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/electron-login';
    return NextResponse.redirect(url);
  }

  if (!user && !isPublicRoute(request.nextUrl.pathname)) {
    if (isElectron) {
      logElectronAuthRedirect(request, {
        authErrorMessage: getUserError?.message ?? null,
        authErrorName: getUserError?.name ?? null,
        authErrorStatus: getUserError?.status ?? null,
        reason: 'supabase_get_user_no_user'
      });
    }

    return redirectToLogin(request, isElectron);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']
};
