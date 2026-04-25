import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { getOAuthRuntimeConfig } from '@/lib/auth/oauth-runtime';
import { getSupabaseUrl } from '@/lib/env';

export type VerifiedElectronTokenPayload = {
  sub: string;
  email?: string;
  client_id: string;
  [key: string]: unknown;
};

export class ElectronJwtError extends Error {
  constructor(
    public readonly code:
      | 'invalid_token'
      | 'expired_token'
      | 'invalid_client'
      | 'missing_client_id',
    message: string
  ) {
    super(message);
    this.name = 'ElectronJwtError';
  }
}

let cachedJwks: JWTVerifyGetKey | null = null;
let cachedIssuer: string | null = null;

function getJwks(): { jwks: JWTVerifyGetKey; issuer: string } {
  const supabaseUrl = getSupabaseUrl();
  const issuer = `${supabaseUrl}/auth/v1`;
  if (!cachedJwks || cachedIssuer !== issuer) {
    cachedJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    cachedIssuer = issuer;
  }
  return { jwks: cachedJwks, issuer };
}

export async function verifyElectronAccessToken(
  token: string
): Promise<VerifiedElectronTokenPayload> {
  const { jwks, issuer } = getJwks();

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, jwks, {
      issuer,
      audience: 'authenticated'
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      message.includes('exp') || message.includes('expired') ? 'expired_token' : 'invalid_token';
    throw new ElectronJwtError(code, message);
  }

  const expectedClientId = getOAuthRuntimeConfig().electronClientId;
  if (expectedClientId) {
    if (!payload.client_id) {
      throw new ElectronJwtError('missing_client_id', 'Token is missing client_id claim.');
    }
    if (payload.client_id !== expectedClientId) {
      throw new ElectronJwtError(
        'invalid_client',
        'Token client_id does not match expected Electron client.'
      );
    }
  }

  return payload as VerifiedElectronTokenPayload;
}

export function resetElectronJwtCache(): void {
  cachedJwks = null;
  cachedIssuer = null;
}
