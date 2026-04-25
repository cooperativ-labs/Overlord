import { ElectronJwtError, verifyElectronAccessToken } from '@/lib/auth/electron-jwt';

export type ElectronUser = {
  userId: string;
  email: string | undefined;
  accessToken: string;
  clientId: string;
};

export class ElectronAuthError extends Error {
  constructor(
    public readonly code:
      | 'missing_token'
      | 'invalid_token'
      | 'expired_token'
      | 'invalid_client'
      | 'missing_client_id',
    message: string
  ) {
    super(message);
    this.name = 'ElectronAuthError';
  }

  static isElectronAuthError(err: unknown): err is ElectronAuthError {
    return err instanceof ElectronAuthError;
  }
}

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

async function resolveElectronUser(token: string): Promise<ElectronUser> {
  try {
    const payload = await verifyElectronAccessToken(token);
    return {
      userId: payload.sub,
      email: payload.email,
      accessToken: token,
      clientId: payload.client_id
    };
  } catch (err) {
    if (err instanceof ElectronJwtError) {
      throw new ElectronAuthError(err.code, err.message);
    }
    throw new ElectronAuthError('invalid_token', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Extracts and verifies the Electron access token from an HTTP request object.
 * Suitable for middleware and route handlers that receive a full Request.
 * Throws ElectronAuthError on any failure.
 */
export async function getElectronUserFromRequest(request: Request): Promise<ElectronUser> {
  const token = extractBearer(request.headers.get('authorization'));
  if (!token) {
    throw new ElectronAuthError('missing_token', 'No bearer token found in Authorization header.');
  }
  return resolveElectronUser(token);
}

/**
 * Extracts and verifies the Electron access token from Next.js request headers.
 * Suitable for server components and server actions that use next/headers.
 * Throws ElectronAuthError on any failure.
 */
export async function getElectronUserFromHeaders(
  headerGetter: () => Promise<Headers> | Headers
): Promise<ElectronUser> {
  const headerStore = await headerGetter();
  const token =
    extractBearer(headerStore.get('authorization')) ??
    headerStore.get('x-overlord-access-token')?.trim() ??
    null;
  if (!token) {
    throw new ElectronAuthError(
      'missing_token',
      'No Electron access token found in request headers.'
    );
  }
  return resolveElectronUser(token);
}
