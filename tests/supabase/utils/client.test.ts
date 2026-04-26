import { createBrowserClient } from '@supabase/ssr';

import { createClient, isElectronBearerAuthEnabled } from '@/supabase/utils/client';

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: jest.fn()
}));

describe('isElectronBearerAuthEnabled', () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const originalWindow = globalThis.window;
  const createBrowserClientMock = jest.mocked(createBrowserClient);

  beforeEach(() => {
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

  it('is true in the Electron renderer', () => {
    expect(isElectronBearerAuthEnabled()).toBe(true);
  });

  it('is false outside Electron', () => {
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
});
