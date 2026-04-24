import { headers } from 'next/headers';

type AuthDiagnosticClient = {
  auth: {
    getUser(): Promise<{
      data: { user: { id?: string } | null };
      error: { message?: string; name?: string; status?: number } | null;
    }>;
  };
};

type RequestDiagnostics = {
  electronVersion: string | null;
  hasNextActionHeader: boolean;
  isElectron: boolean;
  refererPath: string | null;
  userAgentKind: 'electron' | 'browser' | 'unknown';
  vercelId: string | null;
};

function suffix(value: string | null | undefined, length = 8): string | null {
  if (!value) return null;
  return value.length <= length ? value : value.slice(-length);
}

function pathFromUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function getElectronVersion(userAgent: string): string | null {
  const match = userAgent.match(/\bElectron\/([^\s]+)/);
  return match?.[1] ?? null;
}

export async function getServerActionRequestDiagnostics(): Promise<RequestDiagnostics> {
  const headerStore = await headers();
  const userAgent = headerStore.get('user-agent') ?? '';
  const electronVersion = getElectronVersion(userAgent);

  return {
    electronVersion,
    hasNextActionHeader: headerStore.has('next-action'),
    isElectron: electronVersion !== null || userAgent.includes('Electron'),
    refererPath: pathFromUrl(headerStore.get('referer')),
    userAgentKind: userAgent.includes('Electron')
      ? 'electron'
      : userAgent.trim().length > 0
        ? 'browser'
        : 'unknown',
    vercelId: headerStore.get('x-vercel-id')
  };
}

export async function getAuthDiagnostics(supabase: AuthDiagnosticClient) {
  try {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    return {
      authErrorMessage: error?.message ?? null,
      authErrorName: error?.name ?? null,
      authErrorStatus: error?.status ?? null,
      userIdSuffix: suffix(user?.id),
      userPresent: Boolean(user)
    };
  } catch (error) {
    return {
      authErrorMessage: error instanceof Error ? error.message : String(error),
      authErrorName: error instanceof Error ? error.name : null,
      authErrorStatus: null,
      userIdSuffix: null,
      userPresent: false
    };
  }
}

export function logElectronServerActionDiagnostic(
  action: string,
  event: string,
  details: Record<string, unknown>
) {
  console.error('[overlord:electron-server-action]', {
    action,
    event,
    ...details
  });
}

export function toErrorDiagnostics(error: unknown) {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorName: error.name
    };
  }

  return {
    errorMessage: String(error),
    errorName: null
  };
}

export function idSuffix(value: string | null | undefined): string | null {
  return suffix(value);
}
