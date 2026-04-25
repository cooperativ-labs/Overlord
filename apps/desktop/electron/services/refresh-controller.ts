import type { ElectronSession, ElectronSessionStore } from './session-store';

const DEFAULT_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type RefreshTokensResult = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
};

export type RefreshTokensFn = (input: {
  platformUrl: string;
  refreshToken: string;
}) => Promise<RefreshTokensResult>;

export type RefreshController = {
  getValidAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string>;
  forceRefresh: () => Promise<string>;
  getSession: () => ElectronSession | null;
};

function decodeJwtExpiry(accessToken: string): number | null {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')
    ) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function accessTokenExpiresAt(session: ElectronSession): number {
  const parsedExpiry = session.accessTokenExpiresAt
    ? Date.parse(session.accessTokenExpiresAt)
    : NaN;
  if (Number.isFinite(parsedExpiry)) {
    return parsedExpiry;
  }

  return session.accessToken ? (decodeJwtExpiry(session.accessToken) ?? 0) * 1000 : 0;
}

function isFreshAccessToken(session: ElectronSession, refreshMarginMs: number): boolean {
  return accessTokenExpiresAt(session) - Date.now() > refreshMarginMs;
}

function normalizeAccessTokenExpiresAt(result: RefreshTokensResult): string | undefined {
  if (result.accessTokenExpiresAt?.trim()) {
    return result.accessTokenExpiresAt.trim();
  }

  const jwtExp = decodeJwtExpiry(result.accessToken);
  return jwtExp ? new Date(jwtExp * 1000).toISOString() : undefined;
}

export function createRefreshController({
  store,
  refreshTokens,
  refreshMarginMs = DEFAULT_REFRESH_MARGIN_MS
}: {
  store: ElectronSessionStore;
  refreshTokens: RefreshTokensFn;
  refreshMarginMs?: number;
}): RefreshController {
  let inFlightRefresh: Promise<string> | null = null;

  const refreshAccessToken = async (forceRefresh: boolean): Promise<string> => {
    const currentSession = store.getSession();
    if (!currentSession) {
      throw new Error('No Electron session is available.');
    }

    if (
      !forceRefresh &&
      currentSession.accessToken &&
      isFreshAccessToken(currentSession, refreshMarginMs)
    ) {
      return currentSession.accessToken;
    }

    if (inFlightRefresh) {
      return inFlightRefresh;
    }

    const refreshPromise = (async () => {
      const session = store.getSession();
      if (!session?.refreshToken) {
        throw new Error('No refresh token available.');
      }
      if (!session.platformUrl) {
        throw new Error('No platform URL available for OAuth refresh.');
      }

      if (!forceRefresh && session.accessToken && isFreshAccessToken(session, refreshMarginMs)) {
        return session.accessToken;
      }

      const refreshed = await refreshTokens({
        platformUrl: session.platformUrl,
        refreshToken: session.refreshToken
      });

      if (!refreshed.accessToken) {
        throw new Error('OAuth refresh did not return an access token.');
      }

      const nextSession = store.updateSession({
        accessToken: refreshed.accessToken,
        accessTokenExpiresAt: normalizeAccessTokenExpiresAt(refreshed),
        refreshToken: refreshed.refreshToken ?? session.refreshToken
      });

      if (!nextSession?.accessToken) {
        throw new Error('OAuth refresh did not return an access token.');
      }

      return nextSession.accessToken;
    })();

    inFlightRefresh = refreshPromise.finally(() => {
      inFlightRefresh = null;
    });

    return inFlightRefresh;
  };

  return {
    getValidAccessToken: ({ forceRefresh = false } = {}) => refreshAccessToken(forceRefresh),
    forceRefresh: () => refreshAccessToken(true),
    getSession: () => store.getSession()
  };
}
