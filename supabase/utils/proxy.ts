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

  // Electron embeds "Electron" in the User-Agent.
  const isElectron = request.headers.get('user-agent')?.includes('Electron');

  // In the Electron app, /login should always go to /electron-login.
  if (isElectron && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/electron-login';
    return NextResponse.redirect(url);
  }

  if (!user && !isPublicRoute(request.nextUrl.pathname)) {
    if (isElectron) {
      const supabaseCookieCount = request.cookies
        .getAll()
        .filter(cookie => cookie.name.includes('auth-token')).length;
      console.error('[overlord:electron-auth-redirect]', {
        authErrorMessage: getUserError?.message ?? null,
        authErrorName: getUserError?.name ?? null,
        authErrorStatus: getUserError?.status ?? null,
        hasNextActionHeader: request.headers.has('next-action'),
        method: request.method,
        pathname: request.nextUrl.pathname,
        refererPath: (() => {
          const referer = request.headers.get('referer');
          if (!referer) return null;
          try {
            const parsed = new URL(referer);
            return `${parsed.pathname}${parsed.search}`;
          } catch {
            return null;
          }
        })(),
        supabaseCookieCount,
        vercelId: request.headers.get('x-vercel-id')
      });
    }

    const url = request.nextUrl.clone();
    const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    url.pathname = isElectron ? '/electron-login' : '/login';
    url.searchParams.set('next', nextPath);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']
};
