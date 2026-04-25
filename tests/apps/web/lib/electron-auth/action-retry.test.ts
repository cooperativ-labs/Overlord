import {
  isRetryableElectronAuthError,
  withElectronActionRetry
} from '@/lib/electron-auth/action-retry';

describe('withElectronActionRetry', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    globalThis.window = originalWindow as typeof globalThis.window;
    jest.restoreAllMocks();
  });

  it('retries exactly once for Electron auth failures', async () => {
    const forceRefresh = jest.fn().mockResolvedValue({ ok: true });
    const action = jest
      .fn()
      .mockRejectedValueOnce({
        name: 'ElectronAuthError',
        code: 'expired_token',
        message: 'expired_token'
      })
      .mockResolvedValue('ok');

    globalThis.window = {
      electronAPI: {
        auth: {
          forceRefresh
        }
      }
    } as unknown as Window & typeof globalThis.window;

    await expect(withElectronActionRetry(action)()).resolves.toBe('ok');
    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('does not retry validation or business errors', async () => {
    const forceRefresh = jest.fn();
    const action = jest.fn().mockRejectedValue(new Error('Project is required.'));

    globalThis.window = {
      electronAPI: {
        auth: {
          forceRefresh
        }
      }
    } as unknown as Window & typeof globalThis.window;

    await expect(withElectronActionRetry(action)()).rejects.toThrow('Project is required.');
    expect(forceRefresh).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the auth refresh fails', async () => {
    const forceRefresh = jest.fn().mockResolvedValue({ ok: false, error: 'expired' });
    const authError = {
      name: 'ElectronAuthError',
      code: 'expired_token',
      message: 'expired_token'
    };
    const action = jest.fn().mockRejectedValue(authError);

    globalThis.window = {
      electronAPI: {
        auth: {
          forceRefresh
        }
      }
    } as unknown as Window & typeof globalThis.window;

    await expect(withElectronActionRetry(action)()).rejects.toBe(authError);
    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryableElectronAuthError', () => {
  it('accepts Electron auth-shaped failures only', () => {
    expect(
      isRetryableElectronAuthError({
        name: 'ElectronAuthError',
        code: 'expired_token',
        message: 'expired_token'
      })
    ).toBe(true);
    expect(isRetryableElectronAuthError(new Error('Project is required.'))).toBe(false);
    expect(
      isRetryableElectronAuthError({
        name: 'Error',
        message: 'Bearer error="invalid_token"'
      })
    ).toBe(true);
  });
});
