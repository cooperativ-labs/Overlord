let supabaseUrl = 'https://test.supabase.co';
const ELECTRON_CLIENT_ID = 'overlord-desktop-test';

jest.mock('jose', () => ({
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn(() => ({ _remoteJwks: true }))
}));

jest.mock('@/lib/env', () => ({
  getSupabaseUrl: () => supabaseUrl
}));

jest.mock('@/lib/auth/oauth-runtime', () => ({
  getOAuthRuntimeConfig: () => ({ electronClientId: ELECTRON_CLIENT_ID })
}));

import {
  ElectronJwtError,
  resetElectronJwtCache,
  verifyElectronAccessToken
} from '@/lib/auth/electron-jwt';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jose = require('jose') as { jwtVerify: jest.Mock; createRemoteJWKSet: jest.Mock };

const VALID_PAYLOAD = {
  sub: 'user-abc',
  email: 'user@example.com',
  aud: 'authenticated',
  iss: 'https://test.supabase.co/auth/v1',
  client_id: ELECTRON_CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600
};

describe('verifyElectronAccessToken', () => {
  beforeEach(() => {
    supabaseUrl = 'https://test.supabase.co';
    resetElectronJwtCache();
    jose.jwtVerify.mockReset();
    jose.createRemoteJWKSet.mockReturnValue({ _remoteJwks: true });
  });

  it('returns typed payload for a valid token', async () => {
    jose.jwtVerify.mockResolvedValue({ payload: VALID_PAYLOAD });

    const result = await verifyElectronAccessToken('valid.jwt.token');

    expect(result.sub).toBe('user-abc');
    expect(result.email).toBe('user@example.com');
    expect(result.client_id).toBe(ELECTRON_CLIENT_ID);
    expect(jose.jwtVerify).toHaveBeenCalledWith('valid.jwt.token', expect.anything(), {
      issuer: ['https://test.supabase.co/auth/v1'],
      audience: 'authenticated'
    });
  });

  it('throws ElectronJwtError with invalid_token for wrong issuer', async () => {
    jose.jwtVerify.mockRejectedValue(new Error('issuer claim check failed'));

    await expect(verifyElectronAccessToken('bad.issuer.token')).rejects.toBeInstanceOf(
      ElectronJwtError
    );
    await expect(verifyElectronAccessToken('bad.issuer.token')).rejects.toMatchObject({
      code: 'invalid_token'
    });
  });

  it('throws ElectronJwtError with invalid_token for wrong audience', async () => {
    jose.jwtVerify.mockRejectedValue(new Error('audience claim check failed'));

    await expect(verifyElectronAccessToken('bad.aud.token')).rejects.toBeInstanceOf(
      ElectronJwtError
    );
    await expect(verifyElectronAccessToken('bad.aud.token')).rejects.toMatchObject({
      code: 'invalid_token'
    });
  });

  it('throws ElectronJwtError with invalid_client for wrong client_id', async () => {
    jose.jwtVerify.mockResolvedValue({
      payload: { ...VALID_PAYLOAD, client_id: 'overlord-cli' }
    });

    await expect(verifyElectronAccessToken('wrong.client.token')).rejects.toBeInstanceOf(
      ElectronJwtError
    );
    await expect(verifyElectronAccessToken('wrong.client.token')).rejects.toMatchObject({
      code: 'invalid_client'
    });
  });

  it('throws ElectronJwtError with expired_token for an expired token', async () => {
    jose.jwtVerify.mockRejectedValue(new Error('"exp" claim timestamp check failed'));

    await expect(verifyElectronAccessToken('expired.jwt.token')).rejects.toBeInstanceOf(
      ElectronJwtError
    );
    await expect(verifyElectronAccessToken('expired.jwt.token')).rejects.toMatchObject({
      code: 'expired_token'
    });
  });

  it('throws ElectronJwtError with invalid_token for a malformed token', async () => {
    jose.jwtVerify.mockRejectedValue(new Error('Invalid Compact JWS'));

    await expect(verifyElectronAccessToken('not-a-jwt')).rejects.toBeInstanceOf(ElectronJwtError);
    await expect(verifyElectronAccessToken('not-a-jwt')).rejects.toMatchObject({
      code: 'invalid_token'
    });
  });

  it('passes the correct JWKS URL, issuer and audience to jose', async () => {
    jose.jwtVerify.mockResolvedValue({ payload: VALID_PAYLOAD });

    await verifyElectronAccessToken('a.b.c');

    expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL('https://test.supabase.co/auth/v1/.well-known/jwks.json')
    );
    expect(jose.jwtVerify).toHaveBeenCalledWith(
      'a.b.c',
      expect.anything(),
      expect.objectContaining({
        issuer: ['https://test.supabase.co/auth/v1'],
        audience: 'authenticated'
      })
    );
  });

  it('accepts localhost and 127.0.0.1 as equivalent local Supabase issuers', async () => {
    supabaseUrl = 'http://localhost:54321';
    jose.jwtVerify.mockResolvedValue({
      payload: {
        ...VALID_PAYLOAD,
        iss: 'http://127.0.0.1:54321/auth/v1'
      }
    });

    await verifyElectronAccessToken('local.jwt.token');

    expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL('http://localhost:54321/auth/v1/.well-known/jwks.json')
    );
    expect(jose.jwtVerify).toHaveBeenCalledWith(
      'local.jwt.token',
      expect.anything(),
      expect.objectContaining({
        issuer: [
          'http://localhost:54321/auth/v1',
          'http://127.0.0.1:54321/auth/v1'
        ],
        audience: 'authenticated'
      })
    );
  });
});
