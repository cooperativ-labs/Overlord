import * as Sentry from '@sentry/nextjs';
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { isElectronRequest } from '@/lib/auth/electron-detect';
import { ElectronAuthError, getElectronUserFromRequest } from '@/lib/auth/get-electron-user';
import { isPublicRoute } from '@/lib/auth/public-routes';
import {
  getPlatformUrl,
  getSupabaseCookieOptions,
  getSupabasePublishableKey,
  getSupabaseUrl
} from '@/lib/env';

const CANONICAL_HOST = 'www.ovld.ai';
const MACHINE_ENDPOINT_PREFIXES = ['/api/health', '/api/protocol', '/api/mcp'];

export function isMachineEndpoint(pathname: string): boolean {
  return MACHINE_ENDPOINT_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

export function shouldReturnBearer401(request: NextRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return true;
  if (request.headers.has('next-action')) return true;
  if (request.nextUrl.searchParams.has('_rsc')) return true;
  if (request.nextUrl.pathname.startsWith('/api/')) return true;

  const acceptHeader = request.headers.get('accept');
  if (!acceptHeader) return false;

  return acceptHeader
    .split(',')
    .map(part => part.trim().toLowerCase())
    .includes('application/json');
}

export function buildElectronRequestHeaders(
  request: NextRequest,
  auth: {
    accessToken: string;
    clientId: string;
    userId: string;
  }
): Headers {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-overlord-access-token', auth.accessToken);
  requestHeaders.set('x-overlord-user-id', auth.userId);
  requestHeaders.set('x-overlord-client-id', auth.clientId);
  return requestHeaders;
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

function electronUnauthorizedResponse(code: 'invalid_token' | 'expired_token') {
  return NextResponse.json(
    { error: code },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer error="${code}"`
      }
    }
  );
}

async function resolveElectronAuth(request: NextRequest): Promise<{
  accessToken: string;
  clientId: string;
  userId: string;
}> {
  const user = await getElectronUserFromRequest(request);
  return {
    accessToken: user.accessToken,
    clientId: user.clientId,
    userId: user.userId
  };
}

export async function updateSession(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  if (hostname === 'ovld.ai') {
    const url = request.nextUrl.clone();
    const canonical = new URL(getPlatformUrl());
    url.protocol = canonical.protocol;
    url.hostname = CANONICAL_HOST;
    return NextResponse.redirect(url, 308);
  }

  const pathname = request.nextUrl.pathname;
  const isElectron = isElectronRequest(request);

  if (isElectron && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/electron-login';
    return NextResponse.redirect(url);
  }

  if (isPublicRoute(pathname) || isMachineEndpoint(pathname)) {
    return NextResponse.next({ request });
  }

  if (isElectron) {
    try {
      const auth = await resolveElectronAuth(request);
      return NextResponse.next({
        request: { headers: buildElectronRequestHeaders(request, auth) }
      });
    } catch (error) {
      const code =
        error instanceof ElectronAuthError && error.code === 'expired_token'
          ? 'expired_token'
          : 'invalid_token';

      if (error instanceof ElectronAuthError && error.code === 'missing_token') {
        Sentry.addBreadcrumb({
          category: 'electron_auth',
          level: 'warning',
          message: 'electron_auth.bearer_missing',
          data: { pathname, method: request.method }
        });
      } else {
        Sentry.addBreadcrumb({
          category: 'electron_auth',
          level: 'warning',
          message: 'electron_auth.bearer_invalid',
          data: {
            code: error instanceof ElectronAuthError ? error.code : 'invalid_token'
          }
        });
      }

      if (shouldReturnBearer401(request)) {
        return electronUnauthorizedResponse(code);
      }

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
    data: { user }
  } = await supabase.auth.getUser();

  if (!user && !isPublicRoute(pathname)) {
    return redirectToLogin(request, isElectron);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']
};
