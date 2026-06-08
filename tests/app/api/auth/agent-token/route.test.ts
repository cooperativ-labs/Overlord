jest.mock('@/app/api/protocol/_lib', () => ({
  internalErrorResponse: () =>
    new Response(JSON.stringify({ error: 'An internal server error occurred.' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
}));
jest.mock('@/supabase/utils/service-role');
jest.mock('@/lib/overlord/cli-auth', () => ({
  createUserScopedAuthClient: jest.fn(() => ({}))
}));
jest.mock('@/lib/overlord/agent-tokens', () => ({
  createAgentTokenForUser: jest.fn()
}));

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/auth/agent-token/route'));
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost/api/auth/agent-token', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
  );
}

function mockGetUser(result: unknown) {
  const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
  createServiceRoleClient.mockReturnValue({
    auth: { getUser: jest.fn(async () => result) }
  });
}

describe('POST /api/auth/agent-token', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 without a bearer token', async () => {
    const res = await post({ label: 'CLI: host' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid session', async () => {
    mockGetUser({ data: { user: null }, error: { message: 'bad' } });

    const res = await post({ label: 'CLI: host' }, { authorization: 'Bearer bad' });
    expect(res.status).toBe(401);
  });

  it('mints a token for a valid session', async () => {
    mockGetUser({ data: { user: { id: 'user-1' } }, error: null });
    const { createAgentTokenForUser } = jest.requireMock('@/lib/overlord/agent-tokens');
    createAgentTokenForUser.mockResolvedValue({
      token: 'oat_deadbeef',
      info: {
        id: 't1',
        label: 'CLI: host',
        tokenPrefix: 'oat_deadbe',
        createdAt: 'now',
        lastUsedAt: null
      }
    });

    const res = await post({ label: 'CLI: host' }, { authorization: 'Bearer good' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ token: 'oat_deadbeef' });
    expect(createAgentTokenForUser).toHaveBeenCalledWith(expect.anything(), 'user-1', 'CLI: host');
  });

  it('returns 400 for an invalid payload', async () => {
    mockGetUser({ data: { user: { id: 'user-1' } }, error: null });
    const res = await post({ label: '' }, { authorization: 'Bearer good' });
    expect(res.status).toBe(400);
  });
});
