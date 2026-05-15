import {
  clearElectronCredentials,
  type ElectronCredentials,
  loadElectronCredentials,
  saveElectronCredentials
} from './electron-credentials';

export type ElectronSession = {
  platformUrl: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  organizationId?: number | null;
  userEmail?: string;
};

type SessionPersistenceAdapter = {
  load: typeof loadElectronCredentials;
  save: typeof saveElectronCredentials;
  clear: typeof clearElectronCredentials;
};

type SessionStoreOptions = Partial<SessionPersistenceAdapter>;

const DEFAULT_PERSISTENCE: SessionPersistenceAdapter = {
  load: loadElectronCredentials,
  save: saveElectronCredentials,
  clear: clearElectronCredentials
};

function cloneSession(session: ElectronSession | null): ElectronSession | null {
  return session ? { ...session } : null;
}

function normalizeSession(session: ElectronSession | null): ElectronSession | null {
  if (!session?.platformUrl.trim() || !session.refreshToken.trim()) {
    return null;
  }

  return {
    platformUrl: session.platformUrl.trim(),
    refreshToken: session.refreshToken.trim(),
    ...(session.accessToken?.trim() ? { accessToken: session.accessToken.trim() } : {}),
    ...(session.accessTokenExpiresAt?.trim()
      ? { accessTokenExpiresAt: session.accessTokenExpiresAt.trim() }
      : {}),
    ...(typeof session.organizationId === 'number' && Number.isFinite(session.organizationId)
      ? { organizationId: session.organizationId }
      : {}),
    ...(session.userEmail?.trim() ? { userEmail: session.userEmail.trim() } : {})
  };
}

function sessionFromCredentials(
  credentials: Awaited<ReturnType<typeof loadElectronCredentials>>
): ElectronSession | null {
  if (!credentials?.platform_url?.trim() || !credentials.refresh_token?.trim()) {
    return null;
  }

  return normalizeSession({
    platformUrl: credentials.platform_url,
    refreshToken: credentials.refresh_token,
    ...(credentials.access_token ? { accessToken: credentials.access_token } : {}),
    ...(credentials.access_token_expires_at
      ? { accessTokenExpiresAt: credentials.access_token_expires_at }
      : {}),
    ...(typeof credentials.organization_id === 'number'
      ? { organizationId: credentials.organization_id }
      : {}),
    ...(credentials.user_email ? { userEmail: credentials.user_email } : {})
  });
}

function credentialsFromSession(session: ElectronSession): ElectronCredentials {
  return {
    platform_url: session.platformUrl,
    refresh_token: session.refreshToken,
    ...(session.accessToken ? { access_token: session.accessToken } : {}),
    ...(session.accessTokenExpiresAt
      ? { access_token_expires_at: session.accessTokenExpiresAt }
      : {}),
    ...(typeof session.organizationId === 'number' && Number.isFinite(session.organizationId)
      ? { organization_id: session.organizationId }
      : {}),
    ...(session.userEmail ? { user_email: session.userEmail } : {})
  };
}

export type ElectronSessionStore = {
  getSession: () => ElectronSession | null;
  setSession: (session: ElectronSession) => Promise<ElectronSession | null>;
  updateSession: (patch: Partial<ElectronSession>) => Promise<ElectronSession | null>;
  clear: () => void;
};

export async function createElectronSessionStore(
  options: SessionStoreOptions = {}
): Promise<ElectronSessionStore> {
  const persistence: SessionPersistenceAdapter = {
    load: options.load ?? DEFAULT_PERSISTENCE.load,
    save: options.save ?? DEFAULT_PERSISTENCE.save,
    clear: options.clear ?? DEFAULT_PERSISTENCE.clear
  };

  let session = sessionFromCredentials(await persistence.load());

  const persist = async (nextSession: ElectronSession | null): Promise<void> => {
    if (!nextSession) {
      persistence.clear();
      return;
    }

    await persistence.save(credentialsFromSession(nextSession));
  };

  return {
    getSession: () => cloneSession(session),
    setSession: async (nextSession: ElectronSession) => {
      const normalized = normalizeSession(nextSession);
      if (!normalized) {
        return cloneSession(session);
      }

      await persist(normalized);
      session = normalized;
      return cloneSession(session);
    },
    updateSession: async (patch: Partial<ElectronSession>) => {
      if (!session) return null;

      const normalized = normalizeSession({
        ...session,
        ...patch
      });
      if (!normalized) return cloneSession(session);

      await persist(normalized);
      session = normalized;
      return cloneSession(session);
    },
    clear: () => {
      session = null;
      persist(null);
    }
  };
}
