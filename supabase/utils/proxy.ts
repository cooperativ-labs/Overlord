import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env';

export async function updateSession(request: NextRequest) {
  // Protocol endpoints are authenticated via bearer token, not Supabase session cookies.
  // Bypass auth session refresh entirely to avoid turning protocol calls into 500s
  // when local auth/session checks fail.
  if (request.nextUrl.pathname.startsWith('/api/protocol')) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request
  });

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
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

  const publicPaths = [
    '/login',
    '/electron-login',
    '/confirm-email',
    '/onboarding',
    '/oauth/',
    '/auth',
    '/privacy',
    '/terms',
    '/api/auth',
    '/callback'
  ];
  const isPublic = publicPaths.some(path => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    // Electron embeds "Electron" in the User-Agent — redirect to the OAuth login screen
    const isElectron = request.headers.get('user-agent')?.includes('Electron');
    url.pathname = isElectron ? '/electron-login' : '/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']
};
