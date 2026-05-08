jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => ({ _remoteJwks: true })),
  jwtVerify: jest.fn(async () => {
    throw new Error('invalid jwt');
  })
}));

jest.mock('@/lib/env', () => ({
  getSupabaseUrl: jest.fn(() => 'http://localhost:54321')
}));

jest.mock('@/supabase/utils/service-role', () => ({
  createServiceRoleClient: jest.fn()
}));

import { resolveProtocolAuth } from '@/lib/overlord/protocol-auth';

describe('resolveProtocolAuth', () => {
  afterEach(() => {
    delete process.env.OVERLORD_LOCAL_SECRET;
  });

  it('accepts the hardcoded local dev token on localhost:3000', async () => {
    const result = await resolveProtocolAuth(
      new Request('http://localhost:3000/api/protocol/attach', {
        headers: {
          Authorization: 'Bearer overlord-local-dev-token'
        }
      })
    );

    expect(result.error).toBeNull();
    expect(result.context).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: 1,
      tokenValue: 'overlord-local-dev-token',
      authMethod: 'local_dev_token'
    });
  });

  it('does not accept the local dev token away from localhost:3000', async () => {
    const result = await resolveProtocolAuth(
      new Request('https://www.ovld.ai/api/protocol/attach', {
        headers: {
          Authorization: 'Bearer overlord-local-dev-token'
        }
      })
    );

    expect(result.context).toBeNull();
    expect(result.error?.status).toBe(401);
  });
});
