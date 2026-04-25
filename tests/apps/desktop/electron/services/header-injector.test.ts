import {
  buildAuthRequestUrlPatterns,
  composeRendererResponseHeaders,
  injectBearerHeaders,
  resolveRequestScope
} from '../../../../../apps/desktop/electron/services/header-injector';

describe('header injector helpers', () => {
  const platformOrigin = 'https://app.example.com';
  const supabaseOrigin = 'https://project.supabase.co';

  it('builds scoped request patterns for platform and Supabase origins only', () => {
    expect(buildAuthRequestUrlPatterns(platformOrigin, supabaseOrigin)).toEqual([
      'https://app.example.com/*',
      'wss://app.example.com/*',
      'https://project.supabase.co/*',
      'wss://project.supabase.co/*'
    ]);
  });

  it('classifies requests by exact origin match', () => {
    expect(resolveRequestScope('https://app.example.com/u', platformOrigin, supabaseOrigin)).toBe(
      'platform'
    );
    expect(
      resolveRequestScope('https://project.supabase.co/rest/v1', platformOrigin, supabaseOrigin)
    ).toBe('supabase');
    expect(
      resolveRequestScope('wss://project.supabase.co/realtime/v1', platformOrigin, supabaseOrigin)
    ).toBe('supabase');
    expect(resolveRequestScope('https://google.com/', platformOrigin, supabaseOrigin)).toBeNull();
  });

  it('injects bearer headers only for configured platform and Supabase requests', () => {
    expect(
      injectBearerHeaders({
        requestUrl: 'https://app.example.com/u',
        requestHeaders: { Accept: 'text/html' },
        accessToken: 'token-123',
        platformOrigin,
        supabaseOrigin
      })
    ).toMatchObject({
      Accept: 'text/html',
      Authorization: 'Bearer token-123',
      'X-Overlord-Client': 'desktop'
    });

    expect(
      injectBearerHeaders({
        requestUrl: 'https://project.supabase.co/rest/v1/tickets',
        requestHeaders: { Accept: 'application/json' },
        accessToken: 'token-123',
        platformOrigin,
        supabaseOrigin
      })
    ).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer token-123'
    });

    expect(
      injectBearerHeaders({
        requestUrl: 'https://google.com/',
        requestHeaders: { Accept: 'text/html' },
        accessToken: 'token-123',
        platformOrigin,
        supabaseOrigin
      })
    ).toEqual({ Accept: 'text/html' });
  });

  it('preserves existing response headers while replacing the CSP header', () => {
    expect(
      composeRendererResponseHeaders(
        {
          'Cache-Control': ['no-store'],
          'Content-Type': ['text/html']
        },
        "default-src 'self'"
      )
    ).toEqual({
      'Cache-Control': ['no-store'],
      'Content-Type': ['text/html'],
      'Content-Security-Policy': ["default-src 'self'"]
    });
  });

  it('strips Supabase auth cookies only from platform responses', () => {
    expect(
      composeRendererResponseHeaders(
        {
          'Set-Cookie': [
            'sb-access-token=abc; Path=/; Secure; HttpOnly',
            'sb-refresh-token=xyz; Path=/; Secure; HttpOnly',
            'theme=dark; Path=/; Secure'
          ]
        },
        "default-src 'self'",
        'https://app.example.com/dashboard',
        platformOrigin
      )
    ).toEqual({
      'Set-Cookie': ['theme=dark; Path=/; Secure'],
      'Content-Security-Policy': ["default-src 'self'"]
    });

    expect(
      composeRendererResponseHeaders(
        {
          'Set-Cookie': [
            'sb-access-token=abc; Path=/; Secure; HttpOnly',
            'theme=dark; Path=/; Secure'
          ]
        },
        "default-src 'self'",
        'https://project.supabase.co/auth/v1',
        platformOrigin
      )
    ).toEqual({
      'Set-Cookie': ['sb-access-token=abc; Path=/; Secure; HttpOnly', 'theme=dark; Path=/; Secure'],
      'Content-Security-Policy': ["default-src 'self'"]
    });
  });
});
