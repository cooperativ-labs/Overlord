import { createBrowserClient } from '@supabase/ssr';

import { createClient, isElectronBearerAuthEnabled } from '@/supabase/utils/client';

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: jest.fn()
}));

describe('isElectronBearerAuthEnabled', () => {
  const originalFlag = process.env.NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const originalWindow = globalThis.window;
  const createBrowserClientMock = jest.mocked(createBrowserClient);

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electronAPI: {
          isElectron: true,
          auth: {
            getAccessToken: jest.fn().mockResolvedValue({
              ok: true,
              accessToken: 'desktop-access-token'
            })
          }
        }
      }
    });
    createBrowserClientMock.mockReset();
    createBrowserClientMock.mockReturnValue({ client: 'mock-supabase-client' } as never);
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH;
    } else {
      process.env.NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH = originalFlag;
    }
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    }
    if (originalSupabaseKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalSupabaseKey;
    }

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
  });

  it('defaults to enabled in Electron when no override is set', () => {
    expect(isElectronBearerAuthEnabled()).toBe(true);
  });

  it('allows the rollout to be rolled back explicitly with 0', () => {
    process.env.NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH = '0';

    expect(isElectronBearerAuthEnabled()).toBe(false);
  });

  it('stays disabled outside Electron', () => {
    window.electronAPI = undefined as typeof window.electronAPI;

    expect(isElectronBearerAuthEnabled()).toBe(false);
  });

  it('builds the Electron client with the main-process access token provider', async () => {
    const client = createClient();

    expect(client).toEqual({ client: 'mock-supabase-client' });
    expect(createBrowserClientMock).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'publishable-key',
      expect.objectContaining({
        accessToken: expect.any(Function)
      })
    );

    const options = createBrowserClientMock.mock.calls[0]?.[2];
    const accessToken = await options?.accessToken?.();
    expect(accessToken).toBe('desktop-access-token');
    expect(window.electronAPI?.auth?.getAccessToken).toHaveBeenCalledTimes(1);
  });

  it('falls back to the cookie client only when the rollback flag is explicitly set', () => {
    process.env.NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH = '0';

    createClient();

    expect(createBrowserClientMock).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'publishable-key',
      expect.objectContaining({
        cookieOptions: expect.any(Object),
        auth: expect.objectContaining({
          autoRefreshToken: false
        })
      })
    );
    expect(createBrowserClientMock.mock.calls[0]?.[2]).not.toHaveProperty('accessToken');
  });
});
