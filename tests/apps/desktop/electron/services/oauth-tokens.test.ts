import {
  OAuthRefreshError,
  refreshOAuthTokens
} from '../../../../../apps/desktop/electron/services/oauth-tokens';

const PLATFORM_URL = 'https://app.example.test';

type FakeResponse = {
  ok: boolean;
  status: number;
  url: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
};

function makeResponse(status: number, body: string, url = PLATFORM_URL): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    json: async () => JSON.parse(body),
    text: async () => body,
    headers: { get: () => null }
  };
}

function mockFetchSequence(responses: Array<() => FakeResponse>): jest.Mock {
  const fn = jest.fn();
  responses.forEach(make => fn.mockImplementationOnce(async () => make()));
  return fn;
}

function authConfigResponse(): FakeResponse {
  return makeResponse(
    200,
    JSON.stringify({
      supabase_url: 'https://supabase.example.test',
      electron_client_id: 'client-123',
      platform_url: PLATFORM_URL
    })
  );
}

describe('refreshOAuthTokens terminal classification', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('flags a 400 invalid_grant as terminal', async () => {
    global.fetch = mockFetchSequence([
      authConfigResponse,
      () => makeResponse(400, '{"error":"invalid_grant"}')
    ]) as unknown as typeof fetch;

    const error = await refreshOAuthTokens(PLATFORM_URL, 'dead-refresh').catch(err => err);
    expect(error).toBeInstanceOf(OAuthRefreshError);
    expect((error as OAuthRefreshError).terminal).toBe(true);
    expect((error as OAuthRefreshError).status).toBe(400);
  });

  it('flags a 401 as terminal', async () => {
    global.fetch = mockFetchSequence([
      authConfigResponse,
      () => makeResponse(401, 'unauthorized')
    ]) as unknown as typeof fetch;

    const error = await refreshOAuthTokens(PLATFORM_URL, 'revoked').catch(err => err);
    expect((error as OAuthRefreshError).terminal).toBe(true);
  });

  it('treats a 500 as transient (recoverable)', async () => {
    global.fetch = mockFetchSequence([
      authConfigResponse,
      () => makeResponse(500, 'server error')
    ]) as unknown as typeof fetch;

    const error = await refreshOAuthTokens(PLATFORM_URL, 'refresh').catch(err => err);
    expect(error).toBeInstanceOf(OAuthRefreshError);
    expect((error as OAuthRefreshError).terminal).toBe(false);
  });

  it('treats a generic 400 (no invalid_grant body) as transient', async () => {
    global.fetch = mockFetchSequence([
      authConfigResponse,
      () => makeResponse(400, 'temporary glitch')
    ]) as unknown as typeof fetch;

    const error = await refreshOAuthTokens(PLATFORM_URL, 'refresh').catch(err => err);
    expect((error as OAuthRefreshError).terminal).toBe(false);
  });

  it('returns rotated tokens on success', async () => {
    global.fetch = mockFetchSequence([
      authConfigResponse,
      () =>
        makeResponse(
          200,
          JSON.stringify({
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 3600
          })
        )
    ]) as unknown as typeof fetch;

    const result = await refreshOAuthTokens(PLATFORM_URL, 'old-refresh');
    expect(result).toEqual({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600
    });
  });
});
