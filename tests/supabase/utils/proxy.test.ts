import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';

import { getElectronUserFromRequest } from '@/lib/auth/get-electron-user';
import {
  buildElectronRequestHeaders,
  isMachineEndpoint,
  shouldReturnBearer401,
  updateSession
} from '@/supabase/utils/proxy';

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn()
}));

jest.mock('@/lib/auth/get-electron-user', () => {
  class ElectronAuthError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'ElectronAuthError';
    }
  }

  return {
    ElectronAuthError,
    getElectronUserFromRequest: jest.fn()
  };
});

const createServerClientMock = jest.mocked(createServerClient);
const getElectronUserFromRequestMock = jest.mocked(getElectronUserFromRequest);

function makeRequest(init: {
  pathname: string;
  method?: string;
  accept?: string;
  nextAction?: boolean;
  search?: string;
  headers?: Record<string, string>;
}): NextRequest {
  const url = new URL(`https://www.ovld.ai${init.pathname}${init.search ?? ''}`);
  const headers = new Headers();
  if (init.accept) headers.set('accept', init.accept);
  if (init.nextAction) headers.set('next-action', '1');
  if (init.headers) {
    for (const [key, value] of Object.entries(init.headers)) {
      headers.set(key, value);
    }
  }

  return Object.assign(new Request(url, { method: init.method ?? 'GET', headers }), {
    nextUrl: url
  }) as unknown as NextRequest;
}

describe('Electron proxy auth classification', () => {
  it('treats health, protocol, and MCP routes as machine endpoints', () => {
    expect(isMachineEndpoint('/api/health')).toBe(true);
    expect(isMachineEndpoint('/api/protocol/read-context')).toBe(true);
    expect(isMachineEndpoint('/api/mcp')).toBe(true);
    expect(isMachineEndpoint('/api/tickets/search')).toBe(false);
  });

  it('returns bearer 401s for action, API, JSON, and RSC requests', () => {
    expect(shouldReturnBearer401(makeRequest({ pathname: '/u', method: 'POST' }))).toBe(true);
    expect(shouldReturnBearer401(makeRequest({ pathname: '/u', nextAction: true }))).toBe(true);
    expect(shouldReturnBearer401(makeRequest({ pathname: '/u', search: '?_rsc=1' }))).toBe(true);
    expect(
      shouldReturnBearer401(
        makeRequest({ pathname: '/api/projects/1/file-tree', accept: 'application/json' })
      )
    ).toBe(true);
  });

  it('allows normal navigations to redirect instead of returning 401', () => {
    expect(shouldReturnBearer401(makeRequest({ pathname: '/u', accept: 'text/html' }))).toBe(false);
    expect(shouldReturnBearer401(makeRequest({ pathname: '/u' }))).toBe(false);
  });
});

describe('Electron proxy bearer enforcement', () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    getElectronUserFromRequestMock.mockReset();
  });

  it('rejects protected Electron requests with stale cookies before any cookie-backed Supabase client is created', async () => {
    getElectronUserFromRequestMock.mockRejectedValue(
      new Error('No bearer token found in Authorization header.')
    );

    const response = await updateSession(
      makeRequest({
        pathname: '/u/abc',
        method: 'POST',
        headers: {
          'x-overlord-client': 'desktop',
          cookie: 'sb-access-token=stale-cookie; sb-refresh-token=stale-refresh'
        }
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_token"');
    expect(createServerClientMock).not.toHaveBeenCalled();
  });
});

describe('Public metadata routes', () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    getElectronUserFromRequestMock.mockReset();
  });

  it('does not require auth for crawler metadata files', async () => {
    for (const pathname of ['/sitemap.xml', '/robots.txt', '/llms.txt', '/llms-full.txt']) {
      const response = await updateSession(makeRequest({ pathname }));

      expect(response.status).toBe(200);
    }

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(getElectronUserFromRequestMock).not.toHaveBeenCalled();
  });
});

describe('Electron request header propagation', () => {
  it('attaches the verified bearer context to downstream request headers', () => {
    const request = makeRequest({ pathname: '/u' });
    request.headers.set('authorization', 'Bearer token');

    const headers = buildElectronRequestHeaders(request, {
      accessToken: 'access-token',
      clientId: 'desktop-client',
      userId: 'user-123'
    });

    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get('x-overlord-access-token')).toBe('access-token');
    expect(headers.get('x-overlord-user-id')).toBe('user-123');
    expect(headers.get('x-overlord-client-id')).toBe('desktop-client');
  });
});
