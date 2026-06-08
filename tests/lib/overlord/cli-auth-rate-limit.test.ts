jest.mock('@/supabase/utils/service-role');

import { enforceCliAuthRateLimit } from '@/lib/overlord/cli-auth';

type CountResult = { count: number | null; error: { message: string } | null };

/**
 * Build a service-role mock whose `.from().select().eq().gte()` resolves to the
 * supplied count for each successive call, and records inserts.
 */
function buildSupabase(countResults: CountResult[]) {
  const inserts: unknown[] = [];
  let callIndex = 0;

  const from = jest.fn((_table: string) => {
    const builder = {
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      gte: jest.fn(() => {
        const result = countResults[callIndex] ?? { count: 0, error: null };
        callIndex += 1;
        return Promise.resolve(result);
      }),
      insert: jest.fn((row: unknown) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      })
    };
    return builder;
  });

  return { client: { from }, inserts };
}

describe('enforceCliAuthRateLimit', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockClient(countResults: CountResult[]) {
    const { client, inserts } = buildSupabase(countResults);
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(client);
    return inserts;
  }

  it('allows and records an attempt under the limit', async () => {
    const inserts = mockClient([
      { count: 1, error: null }, // ip
      { count: 0, error: null } // email
    ]);

    const result = await enforceCliAuthRateLimit({
      kind: 'signup_request',
      email: 'a@b.com',
      ip: '1.2.3.4'
    });

    expect(result.limited).toBe(false);
    expect(inserts).toEqual([
      { kind: 'signup_request', email: 'a@b.com', requester_ip: '1.2.3.4' }
    ]);
  });

  it('limits when the IP is over the threshold', async () => {
    const inserts = mockClient([{ count: 5, error: null }]); // ip check trips first

    const result = await enforceCliAuthRateLimit({
      kind: 'signup_request',
      email: 'a@b.com',
      ip: '1.2.3.4'
    });

    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(inserts).toHaveLength(0); // no attempt recorded when limited
  });

  it('limits when the email is over the threshold even if IP is fine', async () => {
    mockClient([
      { count: 0, error: null }, // ip ok
      { count: 9, error: null } // email over
    ]);

    const result = await enforceCliAuthRateLimit({
      kind: 'login_request',
      email: 'a@b.com',
      ip: '9.9.9.9'
    });

    expect(result.limited).toBe(true);
  });

  it('fails open when the count query errors', async () => {
    const inserts = mockClient([
      { count: null, error: { message: 'boom' } },
      { count: null, error: { message: 'boom' } }
    ]);

    const result = await enforceCliAuthRateLimit({
      kind: 'verify',
      email: 'a@b.com',
      ip: '1.2.3.4'
    });

    expect(result.limited).toBe(false);
    expect(inserts).toHaveLength(1);
  });
});
