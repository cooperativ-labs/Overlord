import {
  createRefreshController,
  type RefreshTokensFn
} from '../../../../../apps/desktop/electron/services/refresh-controller';
import type {
  ElectronSession,
  ElectronSessionStore
} from '../../../../../apps/desktop/electron/services/session-store';

function createTestStore(initialSession: ElectronSession | null): ElectronSessionStore {
  let session = initialSession ? { ...initialSession } : null;

  return {
    getSession: () => (session ? { ...session } : null),
    setSession: nextSession => {
      session = { ...nextSession };
      return session ? { ...session } : null;
    },
    updateSession: patch => {
      if (!session) return null;
      session = { ...session, ...patch };
      return { ...session };
    },
    clear: () => {
      session = null;
    }
  };
}

function createExpiredSession(): ElectronSession {
  return {
    platformUrl: 'http://localhost:3000',
    accessToken: 'expired-access-token',
    accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    refreshToken: 'refresh-token-old'
  };
}

function createFreshSession(): ElectronSession {
  return {
    platformUrl: 'http://localhost:3000',
    accessToken: 'fresh-access-token',
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refreshToken: 'refresh-token-current'
  };
}

describe('createRefreshController', () => {
  it('returns a cached fresh access token without refreshing', async () => {
    const store = createTestStore(createFreshSession());
    const refreshTokens: RefreshTokensFn = jest.fn(async () => ({
      accessToken: 'should-not-be-used'
    }));

    const controller = createRefreshController({
      store,
      refreshTokens
    });

    await expect(controller.getValidAccessToken()).resolves.toBe('fresh-access-token');
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it('serializes concurrent refresh requests through one OAuth call', async () => {
    const store = createTestStore(createExpiredSession());
    const refreshTokens: RefreshTokensFn = jest.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
      return {
        accessToken: 'new-access-token',
        refreshToken: 'rotated-refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      };
    });

    const controller = createRefreshController({
      store,
      refreshTokens
    });

    const results = await Promise.all(
      Array.from({ length: 12 }, () => controller.getValidAccessToken())
    );

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array.from({ length: 12 }, () => 'new-access-token'));
    expect(store.getSession()).toMatchObject({
      accessToken: 'new-access-token',
      refreshToken: 'rotated-refresh-token'
    });
  });

  it('forces a refresh even when the cached token is still fresh', async () => {
    const store = createTestStore(createFreshSession());
    const refreshTokens: RefreshTokensFn = jest.fn(async () => ({
      accessToken: 'forced-access-token',
      refreshToken: 'forced-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }));

    const controller = createRefreshController({
      store,
      refreshTokens
    });

    await expect(controller.forceRefresh()).resolves.toBe('forced-access-token');
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(store.getSession()).toMatchObject({
      accessToken: 'forced-access-token',
      refreshToken: 'forced-refresh-token'
    });
  });
});
