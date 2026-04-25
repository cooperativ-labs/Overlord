import { fetchWithElectronRetry } from '@/lib/electron-auth/fetch-retry';

describe('fetchWithElectronRetry', () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.window = originalWindow as typeof globalThis.window;
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('retries once after a bearer 401 response', async () => {
    const forceRefresh = jest.fn().mockResolvedValue({ ok: true });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: { 'www-authenticate': 'Bearer error="expired_token"' }
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    globalThis.window = {
      electronAPI: {
        auth: {
          forceRefresh
        }
      }
    } as unknown as Window & typeof globalThis.window;
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const response = await fetchWithElectronRetry('/api/example');

    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
