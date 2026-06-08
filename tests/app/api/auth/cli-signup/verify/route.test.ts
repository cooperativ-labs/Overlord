process.env.OVERLORD_URL = process.env.OVERLORD_URL ?? 'http://localhost:3000';

const mockAuth = {
  signInWithPassword: jest.fn()
};

jest.mock('@/app/api/protocol/_lib', () => ({
  internalErrorResponse: () =>
    new Response(JSON.stringify({ error: 'An internal server error occurred.' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
}));

jest.mock('@/lib/overlord/cli-auth', () => ({
  createAnonAuthClient: jest.fn(() => ({ auth: mockAuth })),
  enforceCliAuthRateLimit: jest.fn(async () => ({ limited: false, retryAfterSeconds: 0 })),
  getClientIp: jest.fn(() => '1.2.3.4'),
  verifyEmailOtp: jest.fn()
}));

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/auth/cli-signup/verify/route'));
});

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/auth/cli-signup/verify', {
      method: 'POST',
      body: JSON.stringify(body)
    })
  );
}

describe('POST /api/auth/cli-signup/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.enforceCliAuthRateLimit.mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
  });

  it('returns the session when the OTP verifies', async () => {
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.verifyEmailOtp.mockResolvedValue({
      session: {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        access_token_expires_at: '2026-06-08T13:00:00.000Z',
        platform_url: 'http://localhost:3000'
      },
      error: null
    });

    const res = await post({ email: 'a@b.com', token: '12345678' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      email: 'a@b.com'
    });
  });

  it('falls back to password sign-in when verification returns no session', async () => {
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.verifyEmailOtp.mockResolvedValue({ session: null, error: { message: 'no session' } });
    mockAuth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'a2', refresh_token: 'r2', expires_at: 1_900_000_000 } },
      error: null
    });

    const res = await post({ email: 'a@b.com', token: '12345678', password: 'hunter2hunter2' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ access_token: 'a2', refresh_token: 'r2' });
  });

  it('returns 400 on an invalid code', async () => {
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.verifyEmailOtp.mockResolvedValue({
      session: null,
      error: { message: 'Token has expired or is invalid', code: 'otp_expired' }
    });

    const res = await post({ email: 'a@b.com', token: '00000000' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'otp_expired' });
  });

  it('returns 429 when rate limited', async () => {
    const cliAuth = jest.requireMock('@/lib/overlord/cli-auth');
    cliAuth.enforceCliAuthRateLimit.mockResolvedValue({ limited: true, retryAfterSeconds: 600 });

    const res = await post({ email: 'a@b.com', token: '12345678' });
    expect(res.status).toBe(429);
  });
});
